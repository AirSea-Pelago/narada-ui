from __future__ import division
import os
import time
import argparse
import warnings

import cv2
import numpy as np
import torch
import torch.nn as nn
from torchvision import transforms
import scipy.spatial

from Networks.HR_Net.seg_hrnet import get_seg_model

warnings.filterwarnings("ignore")

# --- transforms (same as your current script) ---
img_transform = transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                     std=[0.229, 0.224, 0.225])
tensor_transform = transforms.ToTensor()

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--pre", required=True, help="path to checkpoint .pth")
    p.add_argument("--gpu_id", default="0")
    p.add_argument("--source", required=True,
                   help="Video source: /path/to.mp4 OR integer webcam id (e.g. 0) OR rtsp://...")
    p.add_argument("--out", default="", help="Optional output video path (e.g. out.mp4 or out.avi)")
    p.add_argument("--show", action="store_true", help="Show live window")
    p.add_argument("--scale", type=float, default=0.5, help="Resize factor for inference (0.5 = half-res)")
    p.add_argument("--mode", type=int, default=1,
                   help="1=overlay(dots) 2=heatmap 3=pointmap 4=quad")
    p.add_argument("--fp16", action="store_true", help="Use autocast fp16 for faster inference (NVIDIA)")
    p.add_argument("--rtsp_gst", action="store_true",
                   help="If source is RTSP, use a low-latency GStreamer pipeline (Linux)")
    p.add_argument("--max_fps", type=float, default=0.0,
                   help="If >0, throttle output processing to this FPS (useful for live streams).")
    return p.parse_args()

def open_capture(source, use_gst=False):
    # webcam id?
    if source.isdigit():
        cap = cv2.VideoCapture(int(source))
        return cap

    # RTSP stream?
    if source.lower().startswith("rtsp://") and use_gst:
        # Low-latency-ish pipeline: drop old frames if we can't keep up
        # (appsink drop=1) is commonly used to avoid accumulating delay. :contentReference[oaicite:1]{index=1}
        gst = (
            f"rtspsrc location={source} latency=0 ! "
            "rtph264depay ! h264parse ! avdec_h264 ! "
            "videoconvert ! appsink drop=1 sync=false"
        )
        cap = cv2.VideoCapture(gst, cv2.CAP_GSTREAMER)
        return cap

    # normal file/URL
    cap = cv2.VideoCapture(source)
    return cap

def choose_writer(out_path, fps, w, h):
    if not out_path:
        return None
    ext = os.path.splitext(out_path)[1].lower()
    # mp4 often works with 'mp4v' in OpenCV; avi commonly with XVID. :contentReference[oaicite:2]{index=2}
    if ext == ".mp4":
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    else:
        fourcc = cv2.VideoWriter_fourcc(*"XVID")
    return cv2.VideoWriter(out_path, fourcc, fps, (w, h))

def counting(d6):
    # Your original logic (kept)
    input_max = torch.max(d6).item()
    keep = torch.nn.functional.max_pool2d(d6, (3, 3), stride=1, padding=1)
    keep = (keep == d6).float()
    x = keep * d6

    x[x < 100.0 / 255.0 * torch.max(x)] = 0
    x[x > 0] = 1

    if input_max < 0.1:
        x = x * 0

    count = int(torch.sum(x).item())
    kpoint = x.data.squeeze(0).squeeze(0).detach().cpu().numpy()  # 2D
    return count, kpoint

def draw_dots_on_image(img_bgr, kpoint, inv_scale=1.0, radius=3):
    # kpoint is in "inference resolution" coords
    ys, xs = np.nonzero(kpoint)
    out = img_bgr.copy()
    for (y, x) in zip(ys, xs):
        ox = int(x * inv_scale)
        oy = int(y * inv_scale)
        cv2.circle(out, (ox, oy), radius, (0, 255, 0), -1)
    return out

def point_map_from_kpoint(kpoint, inv_scale=1.0, out_shape=None):
    if out_shape is None:
        h, w = kpoint.shape
        out_h, out_w = int(h * inv_scale), int(w * inv_scale)
    else:
        out_h, out_w = out_shape[:2]
    pm = np.zeros((out_h, out_w, 3), dtype=np.uint8) + 255
    ys, xs = np.nonzero(kpoint)
    for (y, x) in zip(ys, xs):
        ox = int(x * inv_scale)
        oy = int(y * inv_scale)
        cv2.circle(pm, (ox, oy), 2, (0, 0, 0), -1)
    return pm

def heatmap_from_d6(d6):
    x = d6.detach().cpu().numpy()
    x[x < 0] = 0
    hm = x[0][0]
    if np.max(hm) > 0:
        hm = (hm / np.max(hm) * 255).astype(np.uint8)
    else:
        hm = np.zeros_like(hm, dtype=np.uint8)
    hm = cv2.applyColorMap(hm, 2)
    return hm

def stack_quad(a, b, c, d):
    top = np.hstack((a, b))
    bot = np.hstack((c, d))
    return np.vstack((top, bot))

def main():
    args = parse_args()
    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu_id

    # --- model ---
    model = get_seg_model()
    model = nn.DataParallel(model, device_ids=[0]).cuda()
    model.eval()

    if os.path.isfile(args.pre):
        print(f"=> loading checkpoint '{args.pre}'")
        checkpoint = torch.load(args.pre, map_location="cpu")
        # many checkpoints store {'state_dict': ...}
        sd = checkpoint["state_dict"] if isinstance(checkpoint, dict) and "state_dict" in checkpoint else checkpoint
        model.load_state_dict(sd, strict=False)
    else:
        raise FileNotFoundError(f"Checkpoint not found: {args.pre}")

    # --- capture ---
    cap = open_capture(args.source, use_gst=args.rtsp_gst)
    if not cap.isOpened():
        raise RuntimeError("Failed to open video source.")

    # Try to reduce buffering for live sources (may or may not be supported depending on backend). :contentReference[oaicite:3]{index=3}
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass

    # Prime first frame
    ret, frame0 = cap.read()
    if not ret or frame0 is None:
        raise RuntimeError("Could not read first frame.")

    src_h, src_w = frame0.shape[:2]

    # FPS
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 1e-3:
        fps = 30.0  # fallback
    writer = choose_writer(args.out, fps, src_w, src_h)

    mode = args.mode
    last_time = 0.0
    print("Controls: 1=overlay 2=heatmap 3=pointmap 4=quad | m=cycle | q=quit")

    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            print("End of stream / cannot read more frames. Exiting.")
            break

        # Optional throttle for live streams
        if args.max_fps > 0:
            now = time.time()
            if now - last_time < (1.0 / args.max_fps):
                continue
            last_time = now

        # Inference at scaled resolution
        s = args.scale
        if s != 1.0:
            small = cv2.resize(frame, (0, 0), fx=s, fy=s)
        else:
            small = frame

        image = tensor_transform(small)
        image = img_transform(image).unsqueeze(0).cuda(non_blocking=True)

        with torch.no_grad():
            if args.fp16:
                with torch.cuda.amp.autocast(dtype=torch.float16):
                    d6 = model(image)
            else:
                d6 = model(image)

            count, pred_kpoint = counting(d6)

        inv_scale = (1.0 / s) if s != 0 else 1.0

        # Build views (all returned at ORIGINAL frame size so VideoWriter stays stable)
        overlay = draw_dots_on_image(frame, pred_kpoint, inv_scale=inv_scale, radius=3)
        cv2.putText(overlay, f"Count: {count}", (30, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

        heat = heatmap_from_d6(d6)
        heat = cv2.resize(heat, (src_w, src_h))

        pmap = point_map_from_kpoint(pred_kpoint, inv_scale=inv_scale, out_shape=frame.shape)

        quad = stack_quad(overlay, heat, frame, pmap)

        if mode == 1:
            out_frame = overlay
        elif mode == 2:
            out_frame = heat
        elif mode == 3:
            out_frame = pmap
        else:
            out_frame = quad

        # If quad, it's bigger; don’t write unless you want that. Keep writer output stable.
        if writer is not None:
            if out_frame.shape[0] == src_h and out_frame.shape[1] == src_w:
                writer.write(out_frame)
            else:
                # If user switched to quad, skip writing or resize back (choose one)
                writer.write(cv2.resize(out_frame, (src_w, src_h)))

        if args.show:
            cv2.imshow("Crowd Counting", out_frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            elif key == ord("m"):
                mode = 1 if mode >= 4 else mode + 1
            elif key in (ord("1"), ord("2"), ord("3"), ord("4")):
                mode = int(chr(key))

        print(f"pred:{float(count):.3f}")

    cap.release()
    if writer is not None:
        writer.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
