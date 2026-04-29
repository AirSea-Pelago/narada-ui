#!/usr/bin/env python3
"""
FIDTM Label Assist (single images)
- Auto-predict points using FIDTM (kpoint peaks)
- Manually add/remove points
- Save per-image annotations

Controls:
  Left click  : add point
  Right click : remove nearest point
  S           : save
  N / P       : next / previous image
  R           : reset to model prediction
  Q / ESC     : quit
"""

import os
import sys
import glob
import json
import argparse

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ----------------------------
# Model pieces (copied/adapted from your live script) :contentReference[oaicite:3]{index=3}
# ----------------------------

class GPUPreprocessor:
    def __init__(self, device='cuda'):
        self.device = device
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)

    def __call__(self, frame_bgr, scale=1.0):
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(frame_rgb).to(self.device, non_blocking=True)
        tensor = tensor.permute(2, 0, 1).unsqueeze(0).float() / 255.0

        if scale != 1.0:
            h, w = tensor.shape[2], tensor.shape[3]
            new_h, new_w = int(h * scale), int(w * scale)
            tensor = F.interpolate(tensor, size=(new_h, new_w), mode='bilinear', align_corners=False)

        return (tensor - self.mean) / self.std

def fast_nms_gpu(fidt_output, threshold=0.39, nms_kernel=21):
    input_max = torch.max(fidt_output).item()
    if input_max < 0.1:
        h, w = fidt_output.shape[2], fidt_output.shape[3]
        return 0, np.zeros((h, w), dtype=np.float32)

    padding = nms_kernel // 2
    keep = F.max_pool2d(fidt_output, nms_kernel, stride=1, padding=padding)
    keep = (keep == fidt_output).float()

    x = keep * fidt_output
    x = (x >= threshold * torch.max(fidt_output)).float()
    return int(torch.sum(x).item()), x.squeeze().cpu().numpy()

def load_model(model_path, gpu_id="0"):
    os.environ["CUDA_VISIBLE_DEVICES"] = gpu_id
    torch.backends.cudnn.benchmark = True

    from Networks.HR_Net.seg_hrnet import get_seg_model
    model = get_seg_model()
    model = nn.DataParallel(model, device_ids=[0]).cuda()

    checkpoint = torch.load(model_path, map_location="cpu")
    model.load_state_dict(checkpoint.get("state_dict", checkpoint), strict=False)
    model.eval()
    return model

def run_inference_points(model, preprocessor, frame_bgr, scale=0.7, threshold=0.35, nms_kernel=25):
    src_h, src_w = frame_bgr.shape[:2]
    image = preprocessor(frame_bgr, scale)

    with torch.inference_mode():
        with torch.cuda.amp.autocast(dtype=torch.float16):
            fidt = model(image)
        _, kpoint_small = fast_nms_gpu(fidt.float(), threshold, nms_kernel)

    # Upscale kpoint map back to original resolution
    if scale != 1.0:
        inv = 1.0 / scale
        kpoint = np.zeros((src_h, src_w), dtype=np.uint8)
        ys, xs = np.nonzero(kpoint_small)
        for y, x in zip(ys, xs):
            oy, ox = int(y * inv), int(x * inv)
            if 0 <= oy < src_h and 0 <= ox < src_w:
                kpoint[oy, ox] = 1
    else:
        kpoint = (kpoint_small > 0).astype(np.uint8)

    ys, xs = np.nonzero(kpoint)
    pts = np.column_stack([xs, ys]).astype(np.int32)  # (x,y)
    return pts

# ----------------------------
# Label UI
# ----------------------------

class LabelSession:
    def __init__(self, img_paths, out_dir, model, preprocessor, scale, threshold, nms_kernel,
                 dot_radius=3, remove_radius=12):
        self.img_paths = img_paths
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)

        self.model = model
        self.pre = preprocessor
        self.scale = scale
        self.threshold = threshold
        self.nms_kernel = nms_kernel

        self.dot_radius = dot_radius
        self.remove_radius = remove_radius

        self.idx = 0
        self.img = None
        self.display = None

        self.pred_points = None
        self.points = None  # editable points

        self.window = "FIDTM Label Assist"
        cv2.namedWindow(self.window, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(self.window, self.on_mouse)

    def current_img_path(self):
        return self.img_paths[self.idx]

    def base_name(self):
        return os.path.splitext(os.path.basename(self.current_img_path()))[0]

    def ann_paths(self):
        # store points as .npy (simple), plus .json for portability
        b = self.base_name()
        return (os.path.join(self.out_dir, f"{b}.npy"),
                os.path.join(self.out_dir, f"{b}.json"))

    def load_existing_or_predict(self):
        img_path = self.current_img_path()
        self.img = cv2.imread(img_path)
        if self.img is None:
            raise RuntimeError(f"Failed to read image: {img_path}")

        npy_path, json_path = self.ann_paths()

        if os.path.exists(npy_path):
            self.points = np.load(npy_path).astype(np.int32)
            self.pred_points = self.points.copy()
        elif os.path.exists(json_path):
            with open(json_path, "r") as f:
                data = json.load(f)
            self.points = np.array(data["points"], dtype=np.int32)
            self.pred_points = self.points.copy()
        else:
            self.pred_points = run_inference_points(
                self.model, self.pre, self.img,
                scale=self.scale, threshold=self.threshold, nms_kernel=self.nms_kernel
            )
            self.points = self.pred_points.copy()

    def draw(self):
        disp = self.img.copy()
        # draw points
        for (x, y) in self.points:
            cv2.circle(disp, (int(x), int(y)), self.dot_radius, (0, 0, 255), -1, lineType=cv2.LINE_AA)

        # header
        txt = f"[{self.idx+1}/{len(self.img_paths)}] {os.path.basename(self.current_img_path())} | points={len(self.points)}"
        cv2.rectangle(disp, (0, 0), (disp.shape[1], 35), (0, 0, 0), -1)
        cv2.putText(disp, txt, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # footer help
        help_txt = "LClick:add  RClick:remove  S:save  N/P:next/prev  R:reset  Q:quit"
        cv2.rectangle(disp, (0, disp.shape[0]-30), (disp.shape[1], disp.shape[0]), (0, 0, 0), -1)
        cv2.putText(disp, help_txt, (10, disp.shape[0]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        self.display = disp
        cv2.imshow(self.window, disp)

    def save(self):
        npy_path, json_path = self.ann_paths()
        np.save(npy_path, self.points.astype(np.int32))
        with open(json_path, "w") as f:
            json.dump({
                "image": os.path.basename(self.current_img_path()),
                "points": self.points.tolist()
            }, f)
        print(f"[Saved] {os.path.basename(npy_path)} ({len(self.points)} points)")

    def reset_to_prediction(self):
        self.points = self.pred_points.copy()

    def add_point(self, x, y):
        new_pt = np.array([[x, y]], dtype=np.int32)
        if self.points.size == 0:
            self.points = new_pt
        else:
            self.points = np.vstack([self.points, new_pt])

    def remove_nearest(self, x, y):
        if self.points.size == 0:
            return
        d = self.points.astype(np.float32) - np.array([x, y], dtype=np.float32)
        dist = np.sqrt((d ** 2).sum(axis=1))
        i = int(np.argmin(dist))
        if dist[i] <= self.remove_radius:
            self.points = np.delete(self.points, i, axis=0)

    def on_mouse(self, event, x, y, flags, param):
        if self.img is None:
            return
        if event == cv2.EVENT_LBUTTONDOWN:
            self.add_point(x, y)
            self.draw()
        elif event == cv2.EVENT_RBUTTONDOWN:
            self.remove_nearest(x, y)
            self.draw()

    def next(self):
        self.idx = min(self.idx + 1, len(self.img_paths) - 1)
        self.load_existing_or_predict()

    def prev(self):
        self.idx = max(self.idx - 1, 0)
        self.load_existing_or_predict()

    def loop(self):
        self.load_existing_or_predict()
        self.draw()

        while True:
            key = cv2.waitKey(0) & 0xFF
            if key in (ord('q'), 27):  # q or ESC
                break
            elif key == ord('s'):
                self.save()
            elif key == ord('r'):
                self.reset_to_prediction()
            elif key == ord('n'):
                self.next()
            elif key == ord('p'):
                self.prev()
            self.draw()

        cv2.destroyAllWindows()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="Folder with images (jpg/png)")
    ap.add_argument("--out", required=True, help="Output folder for point annotations")
    ap.add_argument("--model", required=True, help="Path to model.pth")
    ap.add_argument("--gpu", default="0")
    ap.add_argument("--scale", type=float, default=0.7)
    ap.add_argument("--threshold", type=float, default=0.35)
    ap.add_argument("--nms", type=int, default=25)
    args = ap.parse_args()

    img_paths = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        img_paths += glob.glob(os.path.join(args.images, ext))
    img_paths = sorted(img_paths)
    if not img_paths:
        raise SystemExit("No images found in folder.")

    model = load_model(args.model, args.gpu)
    pre = GPUPreprocessor("cuda")

    sess = LabelSession(
        img_paths=img_paths,
        out_dir=args.out,
        model=model,
        preprocessor=pre,
        scale=args.scale,
        threshold=args.threshold,
        nms_kernel=args.nms if args.nms % 2 == 1 else args.nms + 1
    )
    sess.loop()

if __name__ == "__main__":
    main()
