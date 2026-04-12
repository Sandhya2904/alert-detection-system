import math

import cv2
import mediapipe as mp
import numpy as np


LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144]
RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380]

NOSE_TIP_IDX = 1
CHIN_IDX = 152


class DrowsinessPredictor:
    def __init__(self):
        self.model_loaded = False
        self.class_names = ["Non Drowsy", "Drowsy"]

        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        # Eye logic
        self.ear_threshold = 0.23
        self.eye_closed_frame_threshold = 2
        self.eye_closed_counter = 0

        # Head-down logic
        self.head_down_ratio_threshold = 0.58
        self.head_down_frame_threshold = 2
        self.head_down_counter = 0

        # Stability / anti-flicker logic
        self.drowsy_score = 0
        self.max_drowsy_score = 6
        self.drowsy_trigger_score = 2
        self.last_alert_reason = "Monitoring"

    def load_model(self):
        self.model_loaded = True

    def _distance(self, p1, p2):
        return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

    def _extract_points(self, landmarks, width, height, indices):
        points = []
        for idx in indices:
            x = int(landmarks[idx].x * width)
            y = int(landmarks[idx].y * height)
            points.append((x, y))
        return points

    def _eye_aspect_ratio(self, eye_points):
        horizontal = self._distance(eye_points[0], eye_points[3])
        if horizontal == 0:
            return 0.0

        vertical_1 = self._distance(eye_points[1], eye_points[5])
        vertical_2 = self._distance(eye_points[2], eye_points[4])

        return (vertical_1 + vertical_2) / (2.0 * horizontal)

    def _head_down_ratio(self, landmarks, width, height, left_eye_points, right_eye_points):
        eye_points = left_eye_points + right_eye_points
        eye_center_y = float(np.mean([p[1] for p in eye_points]))

        nose_y = landmarks[NOSE_TIP_IDX].y * height
        chin_y = landmarks[CHIN_IDX].y * height

        denominator = max(chin_y - eye_center_y, 1.0)
        ratio = (nose_y - eye_center_y) / denominator

        return float(ratio)

    def _raise_drowsy_score(self):
        self.drowsy_score = min(self.max_drowsy_score, self.drowsy_score + 1)

    def _lower_drowsy_score(self):
        self.drowsy_score = max(0, self.drowsy_score - 1)

    def _is_drowsy_state(self):
        return self.drowsy_score >= self.drowsy_trigger_score

    def predict_frame(self, frame: np.ndarray):
        if frame is None or frame.size == 0:
            return {
                "label": "No Frame",
                "confidence": 0.0,
                "reason": "No frame received",
            }

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            self.eye_closed_counter = 0
            self.head_down_counter = 0
            self._lower_drowsy_score()
            return {
                "label": "No Face",
                "confidence": 0.0,
                "reason": "Face not detected",
            }

        face_landmarks = results.multi_face_landmarks[0].landmark
        height, width = frame.shape[:2]

        left_eye = self._extract_points(face_landmarks, width, height, LEFT_EYE_IDX)
        right_eye = self._extract_points(face_landmarks, width, height, RIGHT_EYE_IDX)

        left_ear = self._eye_aspect_ratio(left_eye)
        right_ear = self._eye_aspect_ratio(right_eye)
        avg_ear = (left_ear + right_ear) / 2.0

        head_down_ratio = self._head_down_ratio(
            face_landmarks, width, height, left_eye, right_eye
        )

        # Eye-closed evidence
        if avg_ear < self.ear_threshold:
            self.eye_closed_counter += 1
        else:
            self.eye_closed_counter = max(0, self.eye_closed_counter - 1)

        # Head-down evidence
        if head_down_ratio > self.head_down_ratio_threshold:
            self.head_down_counter += 1
        else:
            self.head_down_counter = max(0, self.head_down_counter - 1)

        eyes_closed_alert = self.eye_closed_counter >= self.eye_closed_frame_threshold
        head_down_alert = self.head_down_counter >= self.head_down_frame_threshold
        alert_active = eyes_closed_alert or head_down_alert

        active_reason = None
        active_confidence = 0.0

        if eyes_closed_alert and head_down_alert:
            active_reason = "Eyes Closed + Head Down"
            eye_strength = float(
                np.clip((self.ear_threshold - avg_ear) / self.ear_threshold, 0.0, 1.0)
            )
            head_strength = float(
                np.clip(
                    (head_down_ratio - self.head_down_ratio_threshold) / 0.20,
                    0.0,
                    1.0,
                )
            )
            active_confidence = round(0.76 + 0.22 * max(eye_strength, head_strength), 2)

        elif eyes_closed_alert:
            active_reason = "Eyes Closed"
            eye_strength = float(
                np.clip((self.ear_threshold - avg_ear) / self.ear_threshold, 0.0, 1.0)
            )
            active_confidence = round(0.72 + 0.24 * eye_strength, 2)

        elif head_down_alert:
            active_reason = "Head Down"
            head_strength = float(
                np.clip(
                    (head_down_ratio - self.head_down_ratio_threshold) / 0.20,
                    0.0,
                    1.0,
                )
            )
            active_confidence = round(0.72 + 0.24 * head_strength, 2)

        if alert_active:
            self._raise_drowsy_score()
            self.last_alert_reason = active_reason or "Drowsiness Detected"
        else:
            self._lower_drowsy_score()

        if self._is_drowsy_state():
            if alert_active:
                confidence = active_confidence
            else:
                # Hold the alert briefly so the UI does not flicker off instantly
                stability_strength = self.drowsy_score / self.max_drowsy_score
                confidence = round(0.70 + 0.18 * stability_strength, 2)

            return {
                "label": "Drowsy",
                "confidence": confidence,
                "reason": self.last_alert_reason,
            }

        alertness_strength = float(
            np.clip((avg_ear - self.ear_threshold) / 0.12, 0.0, 1.0)
        )
        confidence = round(0.60 + 0.39 * alertness_strength, 2)
        self.last_alert_reason = "Attentive"

        return {
            "label": "Non Drowsy",
            "confidence": confidence,
            "reason": "Attentive",
        }