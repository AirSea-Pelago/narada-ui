#!/usr/bin/env python3
"""
Live Feed Crowd Counter - With Draggable Zone (Fixed)
"""

import sys
import os

sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import argparse
import time
import json
import warnings
import threading
import queue
import subprocess

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import transforms

warnings.filterwarnings("ignore")

img_transform = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
tensor_transform = transforms.ToTensor()


# =============================================================================
# PRESETS
# =============================================================================

PRESETS = {
    "fast": {
        "description": "Fast detection",
        "scale": 0.5,
        "threshold": 0.39,
        "nms_kernel": 15,
    },
    "accurate": {
        "description": "More accurate",
        "scale": 0.7,
        "threshold": 0.39,
        "nms_kernel": 21,
    },
    "sparse": {
        "description": "For sparse crowds (<50)",
        "scale": 0.8,
        "threshold": 0.35,
        "nms_kernel": 31,
    },
    "dense": {
        "description": "For large dense crowds (500+)",
        "scale": 0.6,
        "threshold": 0.28,  # Much lower for dense crowds
        "nms_kernel": 13,   # Smaller to avoid over-suppression
    },
    "ultra_dense": {
        "description": "For very dense crowds (1000+)",
        "scale": 0.5,
        "threshold": 0.25,  # Very low threshold
        "nms_kernel": 11,   # Minimal suppression
    },
    "sweep": {
        "description": "For sweeping large crowds",
        "scale": 0.55,
        "threshold": 0.28,
        "nms_kernel": 11,
    },
}


# =============================================================================
# DRAGGABLE ZONE BOX (FIXED)
# =============================================================================

class DraggableZone: 
    """
    Mouse-draggable counting zone with fixed coordinate handling.
    """
    
    def __init__(self, frame_w, frame_h, margin=80):
        self.frame_w = frame_w
        self.frame_h = frame_h
        self.default_margin = margin
        
        # Zone coordinates (in frame space)
        self.x1 = margin
        self.y1 = margin
        self.x2 = frame_w - margin
        self.y2 = frame_h - margin
        
        # Mouse state
        self.drawing = False
        self.dragging = False
        self.drag_mode = None
        self.drag_start_x = 0
        self.drag_start_y = 0
        self.drag_orig_x1 = 0
        self.drag_orig_y1 = 0
        self.drag_orig_x2 = 0
        self.drag_orig_y2 = 0
        
        # Display scaling
        self.scale_x = 1.0
        self.scale_y = 1.0
        
        # Display options
        self.enabled = True
        self.visible = True
        self.color = (0, 255, 255)
        self.color_drawing = (0, 165, 255)
        self.color_active = (0, 255, 0)
        self.thickness = 2
        self.handle_size = 15  # Larger handles for easier clicking
    
    def set_display_scale(self, display_w, display_h):
        """Set scale for mouse coordinate conversion."""
        self.scale_x = self.frame_w / display_w
        self.scale_y = self.frame_h / display_h
    
    def _to_frame_coords(self, mouse_x, mouse_y):
        """Convert mouse coordinates to frame coordinates."""
        return mouse_x * self.scale_x, mouse_y * self.scale_y
    
    def set_fullscreen(self):
        """Set zone to full frame."""
        self.x1 = 0
        self.y1 = 0
        self.x2 = self.frame_w
        self.y2 = self.frame_h
    
    def set_default(self):
        """Set zone to default (with margin)."""
        self.x1 = self.default_margin
        self.y1 = self.default_margin
        self.x2 = self.frame_w - self.default_margin
        self.y2 = self.frame_h - self.default_margin
    
    def _normalize_rect(self):
        """Ensure x1 < x2 and y1 < y2."""
        if self.x1 > self.x2:
            self.x1, self.x2 = self.x2, self.x1
        if self.y1 > self.y2:
            self.y1, self.y2 = self.y2, self.y1
        
        # Clamp to frame
        self.x1 = max(0, self.x1)
        self.y1 = max(0, self.y1)
        self.x2 = min(self.frame_w, self.x2)
        self.y2 = min(self.frame_h, self.y2)
    
    def _get_handle_at(self, x, y):
        """Check which handle or region the point is in."""
        hs = self.handle_size
        
        # Check corners first (priority)
        # Top-left
        if abs(x - self.x1) <= hs and abs(y - self.y1) <= hs:
            return 'tl'
        # Top-right
        if abs(x - self.x2) <= hs and abs(y - self.y1) <= hs:
            return 'tr'
        # Bottom-left
        if abs(x - self.x1) <= hs and abs(y - self.y2) <= hs:
            return 'bl'
        # Bottom-right
        if abs(x - self.x2) <= hs and abs(y - self.y2) <= hs:
            return 'br'
        
        # Check edges
        # Left edge
        if abs(x - self.x1) <= hs and self.y1 + hs < y < self.y2 - hs:
            return 'left'
        # Right edge
        if abs(x - self.x2) <= hs and self.y1 + hs < y < self.y2 - hs:
            return 'right'
        # Top edge
        if abs(y - self.y1) <= hs and self.x1 + hs < x < self.x2 - hs:
            return 'top'
        # Bottom edge
        if abs(y - self.y2) <= hs and self.x1 + hs < x < self.x2 - hs:
            return 'bottom'
        
        # Check inside (for moving)
        if self.x1 + hs < x < self.x2 - hs and self.y1 + hs < y < self.y2 - hs:
            return 'move'
        
        return None
    
    def on_mouse(self, event, mouse_x, mouse_y, flags, param):
        """Handle mouse events."""
        if not self.visible:
            return
        
        # Convert to frame coordinates
        fx, fy = self._to_frame_coords(mouse_x, mouse_y)
        
        if event == cv2.EVENT_LBUTTONDOWN:
            handle = self._get_handle_at(fx, fy)
            
            if handle: 
                # Start dragging
                self.dragging = True
                self.drag_mode = handle
                self.drag_start_x = fx
                self.drag_start_y = fy
                # Store original zone position
                self.drag_orig_x1 = self.x1
                self.drag_orig_y1 = self.y1
                self.drag_orig_x2 = self.x2
                self.drag_orig_y2 = self.y2
            else:
                # Start drawing new zone
                self.drawing = True
                self.x1 = fx
                self.y1 = fy
                self.x2 = fx
                self.y2 = fy
        
        elif event == cv2.EVENT_MOUSEMOVE: 
            if self.drawing:
                # Update end point while drawing
                self.x2 = max(0, min(fx, self.frame_w))
                self.y2 = max(0, min(fy, self.frame_h))
            
            elif self.dragging:
                # Calculate delta from drag start
                dx = fx - self.drag_start_x
                dy = fy - self.drag_start_y
                
                if self.drag_mode == 'move':
                    # Move entire zone
                    new_x1 = self.drag_orig_x1 + dx
                    new_y1 = self.drag_orig_y1 + dy
                    new_x2 = self.drag_orig_x2 + dx
                    new_y2 = self.drag_orig_y2 + dy
                    
                    # Keep zone within frame
                    w = self.drag_orig_x2 - self.drag_orig_x1
                    h = self.drag_orig_y2 - self.drag_orig_y1
                    
                    if new_x1 < 0:
                        new_x1 = 0
                        new_x2 = w
                    if new_y1 < 0:
                        new_y1 = 0
                        new_y2 = h
                    if new_x2 > self.frame_w:
                        new_x2 = self.frame_w
                        new_x1 = self.frame_w - w
                    if new_y2 > self.frame_h:
                        new_y2 = self.frame_h
                        new_y1 = self.frame_h - h
                    
                    self.x1, self.y1 = new_x1, new_y1
                    self.x2, self.y2 = new_x2, new_y2
                
                elif self.drag_mode == 'tl':
                    # Drag top-left corner
                    self.x1 = max(0, min(self.drag_orig_x1 + dx, self.drag_orig_x2 - 30))
                    self.y1 = max(0, min(self.drag_orig_y1 + dy, self.drag_orig_y2 - 30))
                
                elif self.drag_mode == 'tr':
                    # Drag top-right corner
                    self.x2 = min(self.frame_w, max(self.drag_orig_x2 + dx, self.drag_orig_x1 + 30))
                    self.y1 = max(0, min(self.drag_orig_y1 + dy, self.drag_orig_y2 - 30))
                
                elif self.drag_mode == 'bl': 
                    # Drag bottom-left corner
                    self.x1 = max(0, min(self.drag_orig_x1 + dx, self.drag_orig_x2 - 30))
                    self.y2 = min(self.frame_h, max(self.drag_orig_y2 + dy, self.drag_orig_y1 + 30))
                
                elif self.drag_mode == 'br':
                    # Drag bottom-right corner
                    self.x2 = min(self.frame_w, max(self.drag_orig_x2 + dx, self.drag_orig_x1 + 30))
                    self.y2 = min(self.frame_h, max(self.drag_orig_y2 + dy, self.drag_orig_y1 + 30))
                
                elif self.drag_mode == 'left':
                    self.x1 = max(0, min(self.drag_orig_x1 + dx, self.drag_orig_x2 - 30))
                
                elif self.drag_mode == 'right':
                    self.x2 = min(self.frame_w, max(self.drag_orig_x2 + dx, self.drag_orig_x1 + 30))
                
                elif self.drag_mode == 'top':
                    self.y1 = max(0, min(self.drag_orig_y1 + dy, self.drag_orig_y2 - 30))
                
                elif self.drag_mode == 'bottom': 
                    self.y2 = min(self.frame_h, max(self.drag_orig_y2 + dy, self.drag_orig_y1 + 30))
        
        elif event == cv2.EVENT_LBUTTONUP: 
            if self.drawing:
                self.drawing = False
                self._normalize_rect()
                # Reset to default if too small
                if abs(self.x2 - self.x1) < 50 or abs(self.y2 - self.y1) < 50:
                    self.set_default()
            
            if self.dragging:
                self.dragging = False
                self.drag_mode = None
        
        elif event == cv2.EVENT_LBUTTONDBLCLK: 
            self.set_default()
            print("[Zone] Reset to default")
    
    def contains(self, x, y):
        """Check if point is inside zone."""
        if not self.enabled:
            return True
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2
    
    def filter_points(self, kpoint):
        """Filter keypoints to only those inside zone (vectorized)."""
        if not self.enabled:
            return kpoint
        
        ys, xs = np.nonzero(kpoint)
        if len(xs) == 0:
            return kpoint
        
        # Vectorized filtering - much faster than Python loop
        mask = (xs >= self.x1) & (xs <= self.x2) & (ys >= self.y1) & (ys <= self.y2)
        
        filtered = np.zeros_like(kpoint)
        filtered[ys[mask], xs[mask]] = 1
        
        return filtered
    
    def draw(self, frame=None):
        """Draw zone box on frame."""
        if not self.visible:
            return
        
        # Choose color
        if self.drawing:
            color = self.color_drawing
        elif self.dragging:
            color = self.color_active
        else:
            color = self.color
        
        x1, y1 = int(self.x1), int(self.y1)
        x2, y2 = int(self.x2), int(self.y2)
        
        # Draw main rectangle
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, self.thickness)
        
        # Draw corner handles (filled squares)
        hs = self.handle_size // 2
        corners = [
            (x1, y1, 'TL'),
            (x2, y1, 'TR'),
            (x1, y2, 'BL'),
            (x2, y2, 'BR'),
        ]
        for cx, cy, name in corners:
            cv2.rectangle(frame, (cx - hs, cy - hs), (cx + hs, cy + hs), color, -1)
            cv2.rectangle(frame, (cx - hs, cy - hs), (cx + hs, cy + hs), (0, 0, 0), 1)
        
        # Draw edge handles (circles at midpoints)
        mid_x = (x1 + x2) // 2
        mid_y = (y1 + y2) // 2
        edges = [(mid_x, y1), (mid_x, y2), (x1, mid_y), (x2, mid_y)]
        for ex, ey in edges:
            cv2.circle(frame, (ex, ey), hs, color, -1)
            cv2.circle(frame, (ex, ey), hs, (0, 0, 0), 1)
        
        # Draw dimensions
        zone_w = x2 - x1
        zone_h = y2 - y1
        cv2.putText(frame, f"{zone_w}x{zone_h}",
                   (x1 + 10, y2 - 10),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
    
    def draw_overlay(self, frame, alpha=0.3):
        """Darken area outside zone."""
        if not self.visible or not self.enabled:
            return
        
        overlay = frame.copy()
        x1, y1 = int(self.x1), int(self.y1)
        x2, y2 = int(self.x2), int(self.y2)
        
        cv2.rectangle(overlay, (0, 0), (self.frame_w, y1), (0, 0, 0), -1)
        cv2.rectangle(overlay, (0, y2), (self.frame_w, self.frame_h), (0, 0, 0), -1)
        cv2.rectangle(overlay, (0, y1), (x1, y2), (0, 0, 0), -1)
        cv2.rectangle(overlay, (x2, y1), (self.frame_w, y2), (0, 0, 0), -1)
        
        cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    
    def get_rect(self):
        return (int(self.x1), int(self.y1), int(self.x2), int(self.y2))


# =============================================================================
# IMPROVED SWEEP TRACKER
# =============================================================================

class ImprovedSweepTracker: 
    """Tracker that prevents re-counting when detections flicker."""
    
    def __init__(self, max_distance=50, max_age=10, max_lost_age=60,
                 min_hits=3, grid_size=30, reappear_threshold=80):
        self.max_distance = max_distance
        self.max_age = max_age
        self.max_lost_age = max_lost_age
        self.min_hits = min_hits
        self.grid_size = grid_size
        self.reappear_threshold = reappear_threshold
        self.memory_age = max_lost_age * 6
        self.duplicate_radius = max(20, min(max_distance * 1.25, reappear_threshold * 0.6))
        
        self.tracks = []
        self.lost_tracks = []
        self.counted_ids = set()
        self.baseline_ids = set()
        self.entry_counted_ids = set()
        self.track_memory = {}
        self.baseline_locked = False
        self.baseline_count = 0
        self.baseline_warmup_frames = max(8, min_hits * 3)
        self.next_id = 0
        self.total_unique = 0
        self.frame_count = 0
        self.grid_history = {}
    
    def reset(self):
        self.tracks = []
        self.lost_tracks = []
        self.counted_ids = set()
        self.baseline_ids = set()
        self.entry_counted_ids = set()
        self.track_memory = {}
        self.baseline_locked = False
        self.baseline_count = 0
        self.next_id = 0
        self.total_unique = 0
        self.frame_count = 0
        self.grid_history = {}
        print("[Sweep] Counter reset!")
    
    def _get_grid_cell(self, x, y):
        return (int(x // self.grid_size), int(y // self.grid_size))
    
    def _check_grid_history(self, x, y):
        cell = self._get_grid_cell(x, y)
        candidates = []
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]: 
                neighbor = (cell[0] + dx, cell[1] + dy)
                if neighbor in self.grid_history:
                    candidates.extend(self.grid_history[neighbor])
        return candidates
    
    def _update_grid(self, track_id, x, y):
        cell = self._get_grid_cell(x, y)
        if cell not in self.grid_history:
            self.grid_history[cell] = []
        if track_id not in self.grid_history[cell]:
            self.grid_history[cell].append(track_id)
            if len(self.grid_history[cell]) > 5:
                self.grid_history[cell].pop(0)

    def _remember_track(self, track):
        self.track_memory[track['id']] = {
            'id': track['id'],
            'pos': track['pos'].copy(),
            'velocity': track.get('velocity', np.zeros(2, dtype=np.float32)).copy(),
            'last_seen': self.frame_count,
            'created_frame': track.get('created_frame', self.frame_count),
        }
    
    def _cleanup_grid_history(self):
        """Periodically clean up old grid history to prevent memory leak."""
        # Keep only cells that have been accessed recently
        # Remove cells with very old track IDs
        if len(self.grid_history) > 1000:
            # Keep only the most recent 500 cells
            sorted_cells = sorted(self.grid_history.items(), 
                                 key=lambda x: max(x[1]) if x[1] else 0, 
                                 reverse=True)
            self.grid_history = dict(sorted_cells[:500])

        min_frame = self.frame_count - self.memory_age
        self.track_memory = {
            track_id: memory
            for track_id, memory in self.track_memory.items()
            if memory.get('last_seen', 0) >= min_frame
        }
    
    def update(self, points, frame_shape=None, zone_rect=None):
        self.frame_count += 1
        self.zone_rect = zone_rect
        
        # Periodic cleanup to prevent memory leak
        if self.frame_count % 1000 == 0:
            self._cleanup_grid_history()
        
        for t in self.tracks:
            t['age'] += 1
            t['time_since_update'] += 1
        
        for t in self.lost_tracks:
            t['lost_age'] += 1
        
        self.lost_tracks = [t for t in self.lost_tracks if t['lost_age'] < self.max_lost_age]
        
        if points is None or len(points) == 0:
            self._move_to_lost()
            return self._get_results()
        
        points = np.array(points, dtype=np.float32).reshape(-1, 2)
        
        matched_det, matched_trk, unmatched_det = self._match_active(points)
        
        for det_idx, trk_idx in zip(matched_det, matched_trk):
            t = self.tracks[trk_idx]
            previous_pos = t['pos'].copy()
            t['pos'] = points[det_idx].copy()
            t['velocity'] = 0.7 * t.get('velocity', np.zeros(2, dtype=np.float32)) + 0.3 * (t['pos'] - previous_pos)
            t['hits'] += 1
            t['time_since_update'] = 0
            self._update_zone_state(t)
            self._promote_track_if_ready(t)
            self._update_grid(t['id'], t['pos'][0], t['pos'][1])
            self._remember_track(t)
        
        if len(unmatched_det) > 0 and len(self.lost_tracks) > 0:
            rematched_det, rematched_lost = self._match_lost(points, unmatched_det)
            
            for det_idx, lost_idx in zip(rematched_det, rematched_lost):
                t = self.lost_tracks[lost_idx]
                previous_pos = t['pos'].copy()
                t['pos'] = points[det_idx].copy()
                t['velocity'] = 0.6 * t.get('velocity', np.zeros(2, dtype=np.float32)) + 0.4 * (t['pos'] - previous_pos)
                t['hits'] += 1
                t['time_since_update'] = 0
                t['lost_age'] = 0
                t['state'] = 'confirmed'
                self._update_zone_state(t)
                self.tracks.append(t)
                self._update_grid(t['id'], t['pos'][0], t['pos'][1])
                self._remember_track(t)
                unmatched_det.remove(det_idx)
            
            for lost_idx in sorted(rematched_lost, reverse=True):
                self.lost_tracks.pop(lost_idx)
        
        if len(unmatched_det) > 0 and len(self.track_memory) > 0:
            rematched_det, remembered_ids = self._match_memory(points, unmatched_det)
            for det_idx, remembered_id in zip(rematched_det, remembered_ids):
                memory = self.track_memory[remembered_id]
                self._create_track(
                    points[det_idx],
                    state='confirmed',
                    hits=self.min_hits,
                    track_id=remembered_id,
                    velocity=memory.get('velocity'),
                )
                self._update_zone_state(self.tracks[-1])
                unmatched_det.remove(det_idx)

        for det_idx in list(unmatched_det):
            pt = points[det_idx]
            recent = self._check_grid_history(pt[0], pt[1])
            resurrected_id = self._find_recent_counted_id(pt, recent)
            if resurrected_id is not None:
                memory = self.track_memory.get(resurrected_id, {})
                self._create_track(
                    pt,
                    state='confirmed',
                    hits=self.min_hits,
                    track_id=resurrected_id,
                    velocity=memory.get('velocity'),
                )
                self._update_zone_state(self.tracks[-1])
                unmatched_det.remove(det_idx)

        for det_idx in unmatched_det:
            pt = points[det_idx]
            recent = self._check_grid_history(pt[0], pt[1])
            duplicate_owner, _ = self._nearest_occupied_id(
                pt,
                include_unconfirmed=True,
                created_frame=self.frame_count,
            )
            self._create_track(
                pt,
                is_potential_reappear=bool(recent),
                state='suppressed' if duplicate_owner is not None else 'tentative',
                duplicate_of=duplicate_owner,
                count_suppressed=duplicate_owner is not None,
            )
            self._update_zone_state(self.tracks[-1])
        
        self._move_to_lost()
        return self._get_results()

    def _point_in_zone(self, point):
        if not getattr(self, 'zone_rect', None):
            return True
        x1, y1, x2, y2 = self.zone_rect
        return x1 <= point[0] <= x2 and y1 <= point[1] <= y2

    def _zone_side(self, point):
        if not getattr(self, 'zone_rect', None):
            return 'inside'
        x1, y1, x2, y2 = self.zone_rect
        x, y = point
        if x < x1:
            return 'left'
        if x > x2:
            return 'right'
        if y < y1:
            return 'top'
        if y > y2:
            return 'bottom'
        return 'inside'

    def _update_zone_state(self, track):
        inside = self._point_in_zone(track['pos'])
        side = self._zone_side(track['pos'])
        previous_inside = track.get('zone_inside', False)
        previous_side = track.get('zone_last_side')

        if inside:
            track['zone_hits'] = track.get('zone_hits', 0) + 1
            track['zone_seen_inside'] = True
            if not previous_inside:
                track['zone_entry_side'] = previous_side if previous_side and previous_side != 'inside' else track.get('zone_entry_side')
                track['zone_enter_frame'] = self.frame_count
        elif previous_inside and track.get('zone_seen_inside'):
            track['zone_exit_side'] = side
            track['zone_exit_frame'] = self.frame_count

        track['zone_inside'] = inside
        track['zone_last_side'] = side
        self._count_if_entered_zone(track)

    def _count_if_entered_zone(self, track):
        if not self.baseline_locked:
            return
        if track['id'] in self.baseline_ids or track['id'] in self.entry_counted_ids:
            return
        if track.get('state') != 'confirmed' or not track.get('zone_inside'):
            return
        if track.get('zone_hits', 0) < self.min_hits:
            return
        entry_side = track.get('zone_entry_side')
        if getattr(self, 'zone_rect', None) and (not entry_side or entry_side == 'inside'):
            return
        duplicate_owner, _ = self._nearest_occupied_id(
            track['pos'],
            exclude_id=track['id'],
            include_unconfirmed=False,
            created_frame=track.get('created_frame'),
        )
        if duplicate_owner is not None:
            return

        self.entry_counted_ids.add(track['id'])
        self.counted_ids.add(track['id'])
        track['zone_counted'] = True
    
    def _match_active(self, points):
        if len(self.tracks) == 0:
            return [], [], list(range(len(points)))
        
        track_positions = np.array([
            t['pos'] + t.get('velocity', np.zeros(2, dtype=np.float32)) * max(1, t['time_since_update'])
            for t in self.tracks
        ])
        candidate_pairs = []
        for det_idx, pt in enumerate(points):
            dists = np.linalg.norm(track_positions - pt, axis=1)
            for trk_idx, dist in enumerate(dists):
                gate = self._active_gate(self.tracks[trk_idx])
                if dist <= gate:
                    candidate_pairs.append((dist, det_idx, trk_idx))

        candidate_pairs.sort(key=lambda item: item[0])
        matched_det, matched_trk = [], []
        used_trks = set()
        used_det = set()
        
        for _, det_idx, trk_idx in candidate_pairs:
            if det_idx in used_det or trk_idx in used_trks:
                continue
            matched_det.append(det_idx)
            matched_trk.append(trk_idx)
            used_det.add(det_idx)
            used_trks.add(trk_idx)
        
        unmatched_det = [i for i in range(len(points)) if i not in used_det]
        return matched_det, matched_trk, unmatched_det

    def _active_gate(self, track):
        base = self.max_distance
        if track.get('state') == 'tentative':
            base *= 0.9
        elif track.get('state') == 'suppressed':
            base *= 0.8
        return base * (1.0 + min(1.2, track['time_since_update'] * 0.2))

    def _nearest_occupied_id(self, point, exclude_id=None, include_unconfirmed=False,
                             created_frame=None):
        best_id, best_dist = None, None

        for t in self.tracks:
            if t['id'] == exclude_id:
                continue
            if created_frame is not None and t.get('created_frame') == created_frame:
                continue
            if not include_unconfirmed and t['id'] not in self.counted_ids:
                continue
            dist = float(np.linalg.norm(t['pos'] - point))
            if dist <= self.duplicate_radius and (best_dist is None or dist < best_dist):
                best_id, best_dist = t['id'], dist

        for t in self.lost_tracks:
            if t['id'] == exclude_id:
                continue
            if t['id'] not in self.counted_ids:
                continue
            pos = t.get('last_pos', t['pos'])
            dist = float(np.linalg.norm(pos - point))
            if dist <= self.duplicate_radius and (best_dist is None or dist < best_dist):
                best_id, best_dist = t['id'], dist

        for track_id, memory in self.track_memory.items():
            if track_id == exclude_id or track_id not in self.counted_ids:
                continue
            if created_frame is not None and memory.get('created_frame') == created_frame:
                continue
            dist = float(np.linalg.norm(memory['pos'] - point))
            if dist <= self.duplicate_radius and (best_dist is None or dist < best_dist):
                best_id, best_dist = track_id, dist

        return best_id, best_dist

    def _promote_track_if_ready(self, track):
        if track.get('state') == 'confirmed' or track.get('hits', 0) < self.min_hits:
            return

        duplicate_owner, _ = self._nearest_occupied_id(
            track['pos'],
            exclude_id=track['id'],
            include_unconfirmed=False,
            created_frame=track.get('created_frame'),
        )
        if duplicate_owner is not None and not self._suppressed_track_escaped(track):
            track['state'] = 'suppressed'
            track['count_suppressed'] = True
            track['duplicate_of'] = duplicate_owner
            return

        track['state'] = 'confirmed'
        track['count_suppressed'] = False
        track['duplicate_of'] = None
        self._count_if_entered_zone(track)

    def _suppressed_track_escaped(self, track):
        origin = track.get('origin_pos')
        if origin is None:
            return False
        displacement = float(np.linalg.norm(track['pos'] - origin))
        return displacement >= self.duplicate_radius * 1.6
    
    def _match_lost(self, points, unmatched_det_indices):
        if len(self.lost_tracks) == 0 or len(unmatched_det_indices) == 0:
            return [], []
        
        lost_positions = np.array([
            t['last_pos'] + t.get('velocity', np.zeros(2, dtype=np.float32)) * max(1, t.get('lost_age', 0))
            for t in self.lost_tracks
        ])
        rematched_det, rematched_lost = [], []
        
        for det_idx in unmatched_det_indices:
            pt = points[det_idx]
            dists = np.linalg.norm(lost_positions - pt, axis=1)
            for best_lost in np.argsort(dists):
                if best_lost in rematched_lost:
                    continue
                gate = max(self.reappear_threshold, self.max_distance * 2.5)
                gate += min(80, self.lost_tracks[best_lost].get('lost_age', 0) * 2)
                if dists[best_lost] >= gate:
                    break
                rematched_det.append(det_idx)
                rematched_lost.append(best_lost)
                break
        
        return rematched_det, rematched_lost

    def _find_recent_counted_id(self, point, recent_ids):
        if not recent_ids:
            return None

        active_ids = set(t['id'] for t in self.tracks)
        lost_ids = set(t['id'] for t in self.lost_tracks)
        best_id, best_dist = None, None

        for track_id in reversed(recent_ids):
            if track_id not in self.counted_ids:
                continue
            if track_id in active_ids or track_id in lost_ids:
                continue
            memory = self.track_memory.get(track_id)
            if not memory:
                continue
            age = self.frame_count - memory.get('last_seen', self.frame_count)
            predicted = memory['pos'] + memory.get('velocity', np.zeros(2, dtype=np.float32)) * max(1, age)
            dist = float(np.linalg.norm(predicted - point))
            gate = max(self.reappear_threshold, self.max_distance * 2.0) + min(80, age)
            if dist <= gate and (best_dist is None or dist < best_dist):
                best_id, best_dist = track_id, dist

        return best_id

    def _match_memory(self, points, unmatched_det_indices):
        active_ids = set(t['id'] for t in self.tracks)
        lost_ids = set(t['id'] for t in self.lost_tracks)
        memories = [
            memory for memory in self.track_memory.values()
            if memory['id'] in self.counted_ids
            and memory['id'] not in active_ids
            and memory['id'] not in lost_ids
        ]
        if len(memories) == 0 or len(unmatched_det_indices) == 0:
            return [], []

        memory_positions = np.array([
            m['pos'] + m.get('velocity', np.zeros(2, dtype=np.float32)) * max(1, self.frame_count - m.get('last_seen', self.frame_count))
            for m in memories
        ])
        rematched_det, remembered_ids, used_memory = [], [], set()

        for det_idx in unmatched_det_indices:
            pt = points[det_idx]
            dists = np.linalg.norm(memory_positions - pt, axis=1)
            for memory_idx in np.argsort(dists):
                if memory_idx in used_memory:
                    continue
                memory_age = self.frame_count - memories[memory_idx].get('last_seen', self.frame_count)
                gate = max(self.reappear_threshold, self.max_distance * 3.0) + min(120, memory_age * 1.5)
                if dists[memory_idx] >= gate:
                    break
                rematched_det.append(det_idx)
                remembered_ids.append(memories[memory_idx]['id'])
                used_memory.add(memory_idx)
                break

        return rematched_det, remembered_ids
    
    def _create_track(self, point, is_potential_reappear=False, state='tentative',
                      hits=1, track_id=None, velocity=None, duplicate_of=None,
                      count_suppressed=False):
        if track_id is None:
            track_id = self.next_id
            self.next_id += 1
        else:
            self.next_id = max(self.next_id, track_id + 1)

        self.tracks.append({
            'id': track_id,
            'pos': point.copy(),
            'velocity': velocity.copy() if velocity is not None else np.zeros(2, dtype=np.float32),
            'hits': hits,
            'age': 0,
            'time_since_update': 0,
            'created_frame': self.frame_count,
            'origin_pos': point.copy(),
            'zone_inside': False,
            'zone_seen_inside': False,
            'zone_entry_side': None,
            'zone_exit_side': None,
            'zone_hits': 0,
            'zone_counted': False,
            'state': state,
            'is_potential_reappear': is_potential_reappear,
            'count_suppressed': count_suppressed,
            'duplicate_of': duplicate_of,
        })
        if state == 'confirmed':
            self._count_if_entered_zone(self.tracks[-1])
        self._update_grid(track_id, point[0], point[1])
    
    def _move_to_lost(self):
        still_active = []
        for t in self.tracks:
            if t['time_since_update'] >= self.max_age:
                if t['state'] == 'confirmed':
                    t['lost_age'] = 0
                    t['last_pos'] = t['pos'].copy()
                    self.lost_tracks.append(t)
                    self._remember_track(t)
            else:
                still_active.append(t)
        self.tracks = still_active
    
    def _get_results(self):
        confirmed = [t for t in self.tracks if t['state'] == 'confirmed']
        viewport_tracks = [t for t in confirmed if self._point_in_zone(t['pos'])]
        self._update_baseline(viewport_tracks)
        for t in viewport_tracks:
            self._count_if_entered_zone(t)

        self.total_unique = self.baseline_count + len(self.entry_counted_ids)
        positions = np.array([t['pos'] for t in viewport_tracks]) if viewport_tracks else np.array([])
        return len(viewport_tracks), self.total_unique, positions

    def _update_baseline(self, viewport_tracks):
        if self.baseline_locked:
            return

        stable_tracks = [
            t for t in viewport_tracks
            if t.get('hits', 0) >= self.min_hits
            and not t.get('count_suppressed')
        ]
        stable_ids = set(t['id'] for t in stable_tracks)
        stable_count = len(stable_ids)

        if self.frame_count < self.baseline_warmup_frames:
            self.baseline_count = max(self.baseline_count, stable_count)
            self.baseline_ids = stable_ids
            self.total_unique = self.baseline_count
            return

        self.baseline_count = stable_count
        self.baseline_ids = stable_ids
        self.baseline_locked = True
        self.counted_ids.update(stable_ids)
    
    def get_debug_info(self):
        return {
            'active':  len(self.tracks),
            'confirmed': len([t for t in self.tracks if t['state'] == 'confirmed']),
            'suppressed': len([t for t in self.tracks if t['state'] == 'suppressed']),
            'tentative': len([t for t in self.tracks if t['state'] == 'tentative']),
            'lost': len(self.lost_tracks),
            'remembered': len(self.track_memory),
            'baseline_locked': self.baseline_locked,
            'baseline_count': self.baseline_count,
            'entries': len(self.entry_counted_ids),
            'total_unique': self.total_unique,
        }


# =============================================================================
# GPU PREPROCESSING
# =============================================================================

class GPUPreprocessor:
    def __init__(self, device='cuda'):
        self.device = device
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)
    
    def __call__(self, frame, scale=1.0):
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(frame_rgb).to(self.device, non_blocking=True)
        tensor = tensor.permute(2, 0, 1).unsqueeze(0).float() / 255.0
        
        if scale != 1.0:
            h, w = tensor.shape[2], tensor.shape[3]
            new_h, new_w = int(h * scale), int(w * scale)
            tensor = F.interpolate(tensor, size=(new_h, new_w), mode='bilinear', align_corners=False)
        
        return (tensor - self.mean) / self.std


# =============================================================================
# NMS
# =============================================================================

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


# =============================================================================
# MODEL
# =============================================================================

def load_model(model_path, gpu_id="0"):
    os.environ["CUDA_VISIBLE_DEVICES"] = gpu_id
    torch.backends.cudnn.benchmark = True
    
    print(f"[Model] Loading:  {model_path}")
    
    from Networks.HR_Net.seg_hrnet import get_seg_model
    
    model = get_seg_model()
    model = nn.DataParallel(model, device_ids=[0]).cuda()
    
    checkpoint = torch.load(model_path, map_location="cpu")
    model.load_state_dict(checkpoint.get("state_dict", checkpoint), strict=False)
    model.eval()
    
    print("[Model] Loaded successfully")
    return model


# =============================================================================
# INFERENCE
# =============================================================================

def run_inference(model, preprocessor, frame, scale=0.5, threshold=0.39, nms_kernel=21):
    src_h, src_w = frame.shape[:2]
    image = preprocessor(frame, scale)
    
    with torch.inference_mode():
        with torch.cuda.amp.autocast(dtype=torch.float16):
            fidt = model(image)
        count, kpoint_small = fast_nms_gpu(fidt.float(), threshold, nms_kernel)
    
    if scale != 1.0:
        inv_scale = 1.0 / scale
        kpoint = np.zeros((src_h, src_w), dtype=np.float32)
        ys, xs = np.nonzero(kpoint_small)
        for y, x in zip(ys, xs):
            oy, ox = int(y * inv_scale), int(x * inv_scale)
            if 0 <= oy < src_h and 0 <= ox < src_w:
                kpoint[oy, ox] = 1
    else:
        kpoint = kpoint_small
    
    return count, kpoint


# =============================================================================
# STREAMER
# =============================================================================

def create_streamer(url, width, height, fps=24, bitrate="5000k", codec="libx264", preset="ultrafast", use_nvenc=False):
    codec = "h264_nvenc" if use_nvenc else (codec or "libx264")
    preset = preset or "ultrafast"
    
    if codec == "h264_nvenc":
        cmd = ['ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'bgr24',
               '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
               '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll',
               '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-g', str(fps * 2), '-f', 'flv', url]
    elif codec == "h264_qsv":
        cmd = ['ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'bgr24',
               '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
               '-c:v', 'h264_qsv', '-preset', preset,
               '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-g', str(fps * 2), '-f', 'flv', url]
    else:
        cmd = ['ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'bgr24',
               '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
               '-c:v', 'libx264', '-preset', preset, '-tune', 'zerolatency',
               '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-g', str(fps * 2), '-f', 'flv', url]
    
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# =============================================================================
# FRAME GRABBER
# =============================================================================

class FrameGrabber: 
    def __init__(self, cap, queue_size=1):
        self.cap = cap
        self.q = queue.Queue(maxsize=queue_size)
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self._worker, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def _worker(self):
        while not self.stop_flag.is_set():
            ret, frame = self.cap.read()
            if not ret or frame is None:
                time.sleep(0.01)
                continue
            if self.q.full():
                try:
                    self.q.get_nowait()
                except: 
                    pass
            try:
                self.q.put_nowait(frame)
            except:
                pass

    def read(self, timeout=1.0):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None

    def stop(self):
        self.stop_flag.set()


# =============================================================================
# VISUALIZATION
# =============================================================================

def draw_boxes(frame, kpoint, box_size=14, thickness=2, color=(0, 255, 0)):
    ys, xs = np.nonzero(kpoint)
    if len(xs) == 0:
        return
    h, w = frame.shape[:2]
    half = box_size // 2
    for y, x in zip(ys, xs):
        cv2.rectangle(frame, (max(0, x - half), max(0, y - half)),
                     (min(w - 1, x + half), min(h - 1, y + half)), color, thickness)


def draw_tracked_points(frame, positions, box_size=14, thickness=2, color=(0, 255, 0)):
    if len(positions) == 0:
        return
    h, w = frame.shape[:2]
    half = box_size // 2
    for pt in positions:
        x, y = int(pt[0]), int(pt[1])
        cv2.rectangle(frame, (max(0, x - half), max(0, y - half)),
                     (min(w - 1, x + half), min(h - 1, y + half)), color, thickness)


def draw_info_panel(frame, info_dict, x=30, y=40):
    line_height = 28
    overlay = frame.copy()
    cv2.rectangle(overlay, (x - 10, y - 30), (x + 220, y + len(info_dict) * line_height - 15), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    
    current_y = y
    for key, value in info_dict.items():
        if key == "title":
            cv2.putText(frame, str(value), (x, current_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        elif key == "total": 
            cv2.putText(frame, f"Total: {value}", (x, current_y), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
        elif key == "viewport":
            cv2.putText(frame, f"In View: {value}", (x, current_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        elif key == "fps":
            cv2.putText(frame, f"FPS: {value:.0f}", (x, current_y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        else:
            cv2.putText(frame, f"{key}: {value}", (x, current_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        current_y += line_height
        

def draw_dots(frame, kpoint, radius=1, color=(0, 0, 255)):
    ys, xs = np.nonzero(kpoint)
    if len(xs) == 0:
        return
    for y, x in zip(ys, xs):
        # Use AA for smooth dots
        cv2.circle(frame, (x, y), radius, color, -1, lineType=cv2.LINE_AA)

def draw_tracked_dots(frame, positions, radius=6, color=(0, 255, 255), thickness=-1):
    if len(positions) == 0:
        return
    for pt in positions:
        x, y = int(pt[0]), int(pt[1])
        cv2.circle(frame, (x, y), radius, color, thickness)


def draw_help(frame):
    h = frame.shape[0]
    cv2.putText(frame, "Mouse:  Draw/Drag zone | Q=Quit R=Reset Z=Zone O=Overlay F=Fullscreen",
               (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 180, 180), 1)


# =============================================================================
# LIVE CONTROL
# =============================================================================

def start_control_thread():
    control_q = queue.Queue()

    def _reader():
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            try:
                message = json.loads(line)
            except Exception:
                continue
            if message.get("type") == "config":
                control_q.put(message.get("config", {}))

    threading.Thread(target=_reader, daemon=True).start()
    return control_q


def parse_bool(value):
    return str(value).lower() in ("1", "true", "yes", "on")


def apply_zone_rect(zone, zone_rect_norm, frame_w, frame_h):
    if not zone or not zone_rect_norm:
        return

    zx1, zy1, zx2, zy2 = [float(v.strip()) for v in str(zone_rect_norm).split(",")]
    zone.x1 = max(0, min(frame_w, zx1 * frame_w))
    zone.y1 = max(0, min(frame_h, zy1 * frame_h))
    zone.x2 = max(0, min(frame_w, zx2 * frame_w))
    zone.y2 = max(0, min(frame_h, zy2 * frame_h))
    zone._normalize_rect()


def filter_points_to_tracking_rect(points, zone_rect, frame_w, frame_h, margin_ratio=0.18):
    if points is None or len(points) == 0 or not zone_rect:
        return points

    x1, y1, x2, y2 = zone_rect
    margin_x = max(30, int((x2 - x1) * margin_ratio))
    margin_y = max(30, int((y2 - y1) * margin_ratio))
    rx1 = max(0, x1 - margin_x)
    ry1 = max(0, y1 - margin_y)
    rx2 = min(frame_w, x2 + margin_x)
    ry2 = min(frame_h, y2 + margin_y)
    mask = (
        (points[:, 0] >= rx1)
        & (points[:, 0] <= rx2)
        & (points[:, 1] >= ry1)
        & (points[:, 1] <= ry2)
    )
    return points[mask]


def apply_control_messages(control_q, zone, frame_w, frame_h, default_margin, show_overlay, tracker=None):
    updated = False

    while True:
        try:
            config = control_q.get_nowait()
        except queue.Empty:
            break

        if "zone_enabled" in config:
            if zone is None and parse_bool(config.get("zone_enabled")):
                zone = DraggableZone(frame_w, frame_h, margin=default_margin)
            if zone is not None:
                zone.enabled = parse_bool(config.get("zone_enabled"))
                zone.visible = zone.enabled
            updated = True

        if zone is not None and "zone_margin" in config:
            try:
                zone.default_margin = int(config.get("zone_margin"))
            except Exception:
                pass

        if zone is not None and config.get("zone_rect_norm"):
            try:
                apply_zone_rect(zone, config.get("zone_rect_norm"), frame_w, frame_h)
            except Exception as exc:
                print(json.dumps({"type": "error", "message": f"Invalid zone update: {exc}"}), flush=True)
            updated = True

        if "zone_overlay" in config:
            show_overlay = parse_bool(config.get("zone_overlay"))

        if parse_bool(config.get("reset_sweep")) and tracker is not None:
            tracker.reset()
            print(json.dumps({"type": "log", "message": "Street sweep total reset"}), flush=True)

    if updated:
        print(json.dumps({"type": "log", "message": "Counting zone updated"}), flush=True)

    return zone, show_overlay


# =============================================================================
# STREAM RECONNECTION
# =============================================================================

def reconnect_stream(source, max_retries=5, initial_delay=1.0):
    """Attempt to reconnect to a stream with exponential backoff."""
    is_stream = source.lower().startswith(("rtsp://", "rtmp://", "http://"))
    
    for attempt in range(max_retries):
        try:
            print(f"[Reconnect] Attempt {attempt + 1}/{max_retries}...")
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG) if is_stream else cv2.VideoCapture(source)
            
            if cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    print("[Reconnect] Success!")
                    return cap, frame
                cap.release()
            
            if attempt < max_retries - 1:
                delay = initial_delay * (2 ** attempt)
                print(f"[Reconnect] Failed, retrying in {delay:.1f}s...")
                time.sleep(delay)
        except Exception as e:
            print(f"[Reconnect] Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(initial_delay * (2 ** attempt))
    
    return None, None


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Crowd Counter with Draggable Zone')
    
    parser.add_argument('--source', '-s', required=True, help='Video source')
    parser.add_argument('--output', '-o', default='', help='Stream output URL')
    parser.add_argument('--save', default='', help='Save to file')
    parser.add_argument('--model', '-m', default='', help='Model path')
    parser.add_argument('--preset', '-p', default='accurate', choices=list(PRESETS.keys()))
    parser.add_argument('--show', action='store_true', help='Show preview')
    parser.add_argument('--json', action='store_true', help='JSON output')
    
    parser.add_argument('--sweep', action='store_true', help='Enable sweep mode')
    parser.add_argument('--max_dist', type=int, default=50)
    parser.add_argument('--memory', type=int, default=60)
    parser.add_argument('--min_hits', type=int, default=3)
    
    parser.add_argument('--zone', action='store_true', help='Enable draggable zone')
    parser.add_argument('--zone_margin', type=int, default=80)
    parser.add_argument('--zone_overlay', action='store_true')
    parser.add_argument('--zone_rect_norm', type=str, default='', help='Normalized zone x1,y1,x2,y2 from UI')
    parser.add_argument('--hide_zone', action='store_true', help='Use zone for filtering without drawing it')
    parser.add_argument('--hide_hud', action='store_true', help='Do not draw count/FPS/help text on frames')
    
    parser.add_argument('--threshold', '-t', type=float)
    parser.add_argument('--scale', type=float)
    parser.add_argument('--nms', type=int)
    parser.add_argument('--box_size', type=int, default=14)
    parser.add_argument('--box_thickness', type=int, default=2)
    parser.add_argument('--dot', action='store_true', help='Display dots instead of boxes')
    parser.add_argument('--gpu', default='0')
    parser.add_argument('--nvenc', action='store_true')
    parser.add_argument('--skip', type=int, default=1)
    parser.add_argument('--queue_size', type=int, default=1)
    parser.add_argument('--stream_fps', type=int, default=24)
    parser.add_argument('--stream_bitrate', default='5000k')
    parser.add_argument('--stream_codec', default='libx264')
    parser.add_argument('--stream_preset', default='ultrafast')
    parser.add_argument('--stream_width', type=int, default=0)
    parser.add_argument('--stream_height', type=int, default=0)
    parser.add_argument('--window_size', type=str, default='1280x720', help='Preview window size (WxH, e.g., 1920x1080)')

    args = parser.parse_args()
    
    if args.sweep and args.preset != 'sweep':
        args.preset = 'sweep'
    
    preset = PRESETS[args.preset]
    scale = args.scale or preset['scale']
    threshold = args.threshold or preset['threshold']
    nms_kernel = args.nms or preset['nms_kernel']
    if nms_kernel % 2 == 0:
        nms_kernel += 1
    
    print("=" * 50)
    print("Crowd Counter" + (" - SWEEP MODE" if args.sweep else ""))
    print("=" * 50)
    print(f"Preset: {args.preset}, Scale: {scale}, Threshold:  {threshold}")
    
    # Find model
    model_path = args.model
    if not model_path: 
        for p in [os.path.join(SCRIPT_DIR, 'models', 'model.pth'), os.path.join(SCRIPT_DIR, 'model.pth')]:
            if os.path.exists(p):
                model_path = p
                break
    
    if not model_path or not os.path.exists(model_path):
        print("[ERROR] Model not found!")
        return
    
    # Load model
    try:
        model = load_model(model_path, args.gpu)
        preprocessor = GPUPreprocessor('cuda')
    except Exception as e: 
        print(f"[ERROR] {e}")
        return
    
    # Open source
    print(f"[Source] Opening: {args.source}")
    cap = cv2.VideoCapture(args.source, cv2.CAP_FFMPEG) if args.source.lower().startswith(("rtsp://", "rtmp://")) else cv2.VideoCapture(args.source)
    
    if not cap.isOpened():
        print("[ERROR] Cannot open source")
        return
    
    ret, frame = cap.read()
    if not ret:
        print("[ERROR] Cannot read from source")
        return
    
    src_h, src_w = frame.shape[:2]
    print(f"[Source] Resolution:  {src_w}x{src_h}")
    
    out_w, out_h = src_w, src_h
    if args.stream_width > 0 and args.stream_height > 0:
        out_w, out_h = args.stream_width, args.stream_height
    elif args.stream_width > 0:
        out_w = args.stream_width
        out_h = max(1, int(src_h * (out_w / src_w)))
    elif args.stream_height > 0:
        out_h = args.stream_height
        out_w = max(1, int(src_w * (out_h / src_h)))
    
    # Setup zone
    zone = DraggableZone(src_w, src_h, margin=args.zone_margin) if args.zone else None
    if zone and args.zone_rect_norm:
        try:
            apply_zone_rect(zone, args.zone_rect_norm, src_w, src_h)
        except Exception as e:
            print(f"[Zone] Invalid zone_rect_norm '{args.zone_rect_norm}': {e}")
    show_overlay = args.zone_overlay
    
    # Setup streamer
    streamer = create_streamer(
        args.output,
        out_w,
        out_h,
        fps=args.stream_fps,
        bitrate=args.stream_bitrate,
        codec=args.stream_codec,
        preset=args.stream_preset,
        use_nvenc=args.nvenc,
    ) if args.output else None
    
    # Setup writer
    writer = cv2.VideoWriter(args.save, cv2.VideoWriter_fourcc(*'mp4v'), 24, (src_w, src_h)) if args.save else None
    
    # Setup grabber
    grabber = None
    if args.source.lower().startswith(("rtsp://", "rtmp://")):
        cap.release()
        cap = cv2.VideoCapture(args.source, cv2.CAP_FFMPEG)
        grabber = FrameGrabber(cap, queue_size=max(1, args.queue_size)).start()
    
    # Setup tracker
    tracker = ImprovedSweepTracker(max_distance=args.max_dist, max_age=10, max_lost_age=args.memory, min_hits=args.min_hits) if args.sweep else None
    
    # Setup window
    window_name = "Crowd Counter"
    if args.show:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        
        # Parse window_size argument
        try:
            display_w, display_h = map(int, args.window_size.split('x'))
            display_w = min(display_w, src_w)
            display_h = min(display_h, src_h)
        except:
            print(f"[Warning] Invalid window_size '{args.window_size}', using default")
            display_w = min(src_w, 1280)
            display_h = min(src_h, 720)
        
        cv2.resizeWindow(window_name, display_w, display_h)
        
        if zone:
            zone.set_display_scale(display_w, display_h)
            cv2.setMouseCallback(window_name, zone.on_mouse)
    
    print("\n[Controls] Q=Quit R=Reset Z=Zone O=Overlay F=Fullscreen\n")
    
    # Main loop
    fps, fps_start, fps_count = 0, time.time(), 0
    frame_num = 0
    last_count, last_kpoint = 0, np.zeros((src_h, src_w), dtype=np.float32)
    last_viewport, last_total, last_positions = 0, 0, np.array([])
    last_stats_time = 0
    control_q = start_control_thread()
    consecutive_failures = 0
    max_consecutive_failures = 10
    is_stream = args.source.lower().startswith(("rtsp://", "rtmp://", "http://"))
    
    try:
        while True:
            zone, show_overlay = apply_control_messages(
                control_q,
                zone,
                src_w,
                src_h,
                args.zone_margin,
                show_overlay,
                tracker,
            )

            # Fix: Don't call cap.read() twice - it skips frames!
            if grabber:
                frame = grabber.read(timeout=2.0)
            else:
                ret, frame = cap.read()
                if not ret:
                    frame = None
            
            if frame is None:
                consecutive_failures += 1
                
                # Try to reconnect for streams
                if is_stream and consecutive_failures < max_consecutive_failures:
                    print(f"[Warning] Frame read failed ({consecutive_failures}/{max_consecutive_failures})")
                    
                    # Attempt reconnection
                    if grabber:
                        grabber.stop()
                    cap.release()
                    
                    new_cap, new_frame = reconnect_stream(args.source)
                    if new_cap and new_frame:
                        cap = new_cap
                        if grabber:
                            grabber = FrameGrabber(cap, queue_size=max(1, args.queue_size)).start()
                        frame = new_frame
                        consecutive_failures = 0
                        print("[Info] Reconnected successfully, resuming...")
                    else:
                        print("[Error] Reconnection failed")
                        time.sleep(1.0)
                        continue
                else:
                    print("[INFO] Stream ended or too many failures")
                    break
            else:
                consecutive_failures = 0
            
            if frame.shape[: 2] != (src_h, src_w):
                frame = cv2.resize(frame, (src_w, src_h))
            
            frame_num += 1
            fps_count += 1
            
            if time.time() - fps_start >= 1.0:
                fps = fps_count / (time.time() - fps_start)
                fps_count, fps_start = 0, time.time()
            
            # Process
            if frame_num % args.skip == 0:
                try:
                    last_count, last_kpoint = run_inference(model, preprocessor, frame, scale, threshold, nms_kernel)
                    
                    zone_rect = zone.get_rect() if zone and zone.enabled else None
                    if zone and zone.enabled and not args.sweep:
                        last_kpoint = zone.filter_points(last_kpoint)
                        last_count = int(np.sum(last_kpoint))
                    
                    if tracker: 
                        ys, xs = np.nonzero(last_kpoint)
                        points = np.column_stack((xs, ys)) if len(xs) > 0 else np.array([])
                        if zone_rect is not None:
                            points = filter_points_to_tracking_rect(points, zone_rect, src_w, src_h)
                        last_viewport, last_total, last_positions = tracker.update(points, frame.shape, zone_rect)
                except Exception as e:
                    print(f"[Error] Inference failed: {e}")
                    # Continue with last known values
            
            # Draw
            if zone and show_overlay and not args.hide_zone:
                zone.draw_overlay(frame, alpha=0.3)
            
            if args.dot:
                if args.sweep:
                    draw_tracked_dots(frame, last_positions, radius=max(1, args.box_size // 2))
                else:
                    draw_dots(frame, last_kpoint, radius=max(1, args.box_size // 2))
            else:
                if args.sweep:
                    draw_tracked_points(frame, last_positions, args.box_size, args.box_thickness)
                else:
                    draw_boxes(frame, last_kpoint, args.box_size, args.box_thickness)
            
            if zone and zone.visible and not args.hide_zone:
                zone.draw(frame)
            
            info = {"title": "SWEEP MODE" if args.sweep else "COUNT",
                    "total": last_total if args.sweep else last_count,
                    "viewport": last_viewport} if args.sweep else {"title":  "COUNT", "total": last_count}
            info["fps"] = fps
            
            if not args.hide_hud:
                draw_info_panel(frame, info)
                draw_help(frame)
            
            # Output
            if streamer:
                try:
                    stream_frame = frame
                    if (out_w, out_h) != (src_w, src_h):
                        stream_frame = cv2.resize(frame, (out_w, out_h))
                    streamer.stdin.write(stream_frame.tobytes())
                except Exception as e:
                    print(f"[Error] Streamer write failed: {e}, attempting to recreate...")
                    try:
                        streamer.stdin.close()
                        streamer.wait()
                    except:
                        pass
                    streamer = create_streamer(
                        args.output,
                        out_w,
                        out_h,
                        fps=args.stream_fps,
                        bitrate=args.stream_bitrate,
                        codec=args.stream_codec,
                        preset=args.stream_preset,
                        use_nvenc=args.nvenc,
                    )
            
            if writer:
                writer.write(frame)
            
            if args.show:
                cv2.imshow(window_name, frame)
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    break
                elif key == ord('r') and tracker:
                    tracker.reset()
                elif key == ord('z') and zone:
                    zone.enabled = not zone.enabled
                    zone.visible = zone.enabled
                elif key == ord('o') and zone:
                    show_overlay = not show_overlay
                elif key == ord('f') and zone:
                    zone.set_fullscreen()
            
            # JSON
            if args.json and time.time() - last_stats_time >= 0.5:
                payload = {
                    "type": "stats",
                    "count": int(last_count),
                    "fps": round(fps, 1),
                    "mode": "SWEEP" if args.sweep else "DET"
                }
                if args.sweep:
                    payload["total"] = int(last_total)
                    payload["viewport"] = int(last_viewport)
                    payload["count"] = int(last_total)
                print(json.dumps(payload), flush=True)
                last_stats_time = time.time()
    
    except KeyboardInterrupt:
        print("\n[INFO] Stopped")
    
    finally:
        if grabber:
            grabber.stop()
        cap.release()
        if writer:
            writer.release()
        if streamer:
            streamer.stdin.close()
            streamer.wait()
        if args.show:
            cv2.destroyAllWindows()
        
        if tracker:
            print(f"\n[Final] Total: {tracker.total_unique}")
        print("[Done]")


if __name__ == "__main__":
    main()
