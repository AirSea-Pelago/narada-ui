from __future__ import division

import os
import time
import argparse
import warnings
import threading
import queue
import av

from Networks.HR_Net.seg_hrnet import get_seg_model


rtmp_url = "rtmp://your-server/live/stream"

try:
    container = av.open(rtmp_url)
except av.AVError as e:
    print(f"Error opening stream: {e}")
    exit(1)

for frame in container.decode(video=0):
    img = frame.to_ndarray(format='bgr24')  # Convert to OpenCV format

    # Example: process frame (here we just print its size)
    print(f"Frame size: {img.shape}")

    # Break after some frames for demo
    if frame.pts and frame.pts > 500:
        break
