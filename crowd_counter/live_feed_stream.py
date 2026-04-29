#!/usr/bin/env python3
"""
Compatibility entrypoint for the Electron UI.

The UI was written to launch live_feed_stream.py with a specific set of
arguments. The backend repo provides live_feed_sweep.py with similar behavior
but different argument names, so this wrapper translates the UI contract.
"""

import argparse
import json
import os
import sys

from live_feed_sweep import main as sweep_main


def emit_status(running, message, error=False):
    print(
        json.dumps(
            {
                "type": "status",
                "running": running,
                "message": message,
                "error": error,
            }
        ),
        flush=True,
    )


def map_mode_to_preset(mode):
    mapping = {
        "standard": "accurate",
        "multiscale": "accurate",
        "traffic": "sweep",
        "fast": "fast",
        "accurate": "accurate",
        "sparse": "sparse",
        "dense": "dense",
        "ultra_dense": "ultra_dense",
        "sweep": "sweep",
    }
    return mapping.get((mode or "").lower(), "accurate")


def parse_args():
    parser = argparse.ArgumentParser(description="Electron UI crowd counter adapter")

    parser.add_argument("--pre", default="", help="Model path from UI")
    parser.add_argument("--source", required=True, help="Input stream URL")
    parser.add_argument("--stream_out", default="", help="Output stream URL")
    parser.add_argument("--json_output", action="store_true", help="Emit JSON stats")

    parser.add_argument("--mode", default="standard")
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--scale", type=float)
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--gpu_id", default="0")
    parser.add_argument("--queue_size", type=int)
    parser.add_argument("--track")
    parser.add_argument("--multiscale")
    parser.add_argument("--detect_interval", type=int)
    parser.add_argument("--max_drift", type=float)
    parser.add_argument("--zone_enabled")
    parser.add_argument("--zone_overlay")
    parser.add_argument("--zone_margin", type=int)
    parser.add_argument("--zone_rect_norm")
    parser.add_argument("--sweep_mode")
    parser.add_argument("--ms_scales")
    parser.add_argument("--ms_threshold", type=float)
    parser.add_argument("--ms_nms_radius", type=int)
    parser.add_argument("--overlay_style")
    parser.add_argument("--box_size", type=int)
    parser.add_argument("--box_thickness", type=int)
    parser.add_argument("--stream_fps", type=int)
    parser.add_argument("--stream_bitrate")
    parser.add_argument("--stream_codec")
    parser.add_argument("--stream_preset")
    parser.add_argument("--stream_width", type=int)
    parser.add_argument("--stream_height", type=int)
    parser.add_argument("--out", default="")
    parser.add_argument("--show", action="store_true")

    return parser.parse_args()


def main():
    args = parse_args()
    model_path = args.pre or os.path.join(os.path.dirname(__file__), "models", "model.pth")

    if not os.path.exists(model_path):
        emit_status(False, "Model not found: " + model_path, error=True)
        return 1

    preset = map_mode_to_preset(args.mode)
    sweep_enabled = (
        preset == "sweep"
        or str(args.track).lower() == "true"
        or str(args.sweep_mode).lower() == "true"
    )
    zone_enabled = str(args.zone_enabled).lower() == "true"

    translated = [
        "live_feed_sweep.py",
        "--source",
        args.source,
        "--model",
        model_path,
        "--preset",
        preset,
        "--gpu",
        str(args.gpu_id),
    ]

    if args.stream_out:
        translated.extend(["--output", args.stream_out])
    if args.out:
        translated.extend(["--save", args.out])
    if args.json_output:
        translated.append("--json")
        translated.append("--hide_hud")
        # The Electron UI owns all visible zone/stat overlays. Always keep the
        # backend zone transparent, including when the zone is enabled later via
        # live config updates.
        translated.append("--hide_zone")
    if args.show:
        translated.append("--show")
    if sweep_enabled:
        translated.append("--sweep")
    if zone_enabled:
        translated.append("--zone")
    if zone_enabled and str(args.zone_overlay).lower() == "true":
        translated.append("--zone_overlay")
    if args.zone_margin is not None:
        translated.extend(["--zone_margin", str(args.zone_margin)])
    if args.zone_rect_norm:
        translated.extend(["--zone_rect_norm", args.zone_rect_norm])
    if args.scale is not None:
        translated.extend(["--scale", str(args.scale)])
    if args.threshold is not None:
        translated.extend(["--threshold", str(args.threshold)])
    if args.box_size is not None:
        translated.extend(["--box_size", str(args.box_size)])
    if args.detect_interval is not None and args.detect_interval > 0:
        translated.extend(["--skip", str(args.detect_interval)])
    if args.max_drift is not None:
        translated.extend(["--max_dist", str(int(args.max_drift))])
    if args.ms_nms_radius is not None:
        translated.extend(["--nms", str(args.ms_nms_radius)])
    if args.overlay_style and args.overlay_style.lower() == "dots":
        translated.append("--dot")
    if args.box_thickness is not None:
        translated.extend(["--box_thickness", str(args.box_thickness)])
    if args.stream_fps is not None:
        translated.extend(["--stream_fps", str(args.stream_fps)])
    if args.stream_bitrate:
        translated.extend(["--stream_bitrate", args.stream_bitrate])
    if args.stream_codec:
        translated.extend(["--stream_codec", args.stream_codec])
        if args.stream_codec == "h264_nvenc":
            translated.append("--nvenc")
    if args.stream_preset:
        translated.extend(["--stream_preset", args.stream_preset])
    if args.stream_width is not None and args.stream_width > 0:
        translated.extend(["--stream_width", str(args.stream_width)])
    if args.stream_height is not None and args.stream_height > 0:
        translated.extend(["--stream_height", str(args.stream_height)])
    if args.queue_size is not None:
        translated.extend(["--queue_size", str(args.queue_size)])

    emit_status(True, "Starting crowd counter")
    sys.argv = translated
    return sweep_main() or 0


if __name__ == "__main__":
    raise SystemExit(main())
