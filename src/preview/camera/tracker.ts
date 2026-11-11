import { HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { createJointSet, type Handedness } from '../../core/poses.js';
import type { Stage } from '../../core/stage.js';
import type { HandSample } from '../../runtime/store.js';
import { handFromLabel, imageCenter, OneEuro, placeCameraHand, type CameraHand, type Point3 } from './landmarks.js';
import modelAssetPath from './hand_landmarker.task?url';

/** A hand the camera last saw, and when (seconds, performance clock). */
interface Seen {
  hand: CameraHand;
  time: number;
}

/**
 * A hand counts as gone after three missed detections, between 0.3 and 1 second: slower computers
 * detect less often, and their hands shouldn't flicker.
 */
const lostAfter = (interval: number): number => Math.min(1, Math.max(0.3, interval * 3));
/** Landmark pairs drawn in the camera view. */
const LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
] as const;

/** Real hands from the computer's camera: MediaPipe hand tracking, run on this device. */
export interface CameraTracker {
  /** Hands the camera currently sees. */
  readonly count: number;
  /** Writes one hand into the game's hand sample, placed in front of the stage; untracked when unseen. */
  sample(side: Handedness, stage: Stage, out: HandSample): void;
  stop(): void;
}

/**
 * Opens the camera, loads hand tracking (the engine and model ship with the page; nothing is sent
 * anywhere) and tracks up to two hands on every camera frame. `view` shows the camera picture,
 * mirrored like a mirror, with the tracked hands drawn over it.
 */
export async function startCameraTracker(view: { video: HTMLVideoElement; overlay: HTMLCanvasElement }, status: (text: string) => void): Promise<CameraTracker> {
  status('Asking for your camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  const { video, overlay } = view;
  let landmarker: HandLandmarker | null = null;
  let stopped = false;
  const stopStream = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    video.muted = true;
    video.playsInline = true;
    await playStream(video, stream);
    status('Loading hand tracking…');
    landmarker = await createLandmarker();
  } catch (error) {
    stopStream();
    throw error;
  }
  status('Hold a hand up to the camera');

  const seen: Record<Handedness, Seen | null> = { left: null, right: null };
  const scratch = createJointSet();
  const filters: Record<Handedness, OneEuro> = { left: new OneEuro(scratch.pos.length), right: new OneEuro(scratch.pos.length) };
  const context = overlay.getContext('2d');
  let lastVideoTime = -1;
  let lastStamp = 0;
  let count = 0;
  /** Seconds between detections, smoothed. */
  let interval = 1 / 30;
  let traced = 0;
  let detections = 0;

  const detect = () => {
    if (stopped || !landmarker) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const stamp = Math.max(lastStamp + 1, performance.now());
      if (lastStamp > 0) interval += ((stamp - lastStamp) / 1000 - interval) * 0.2;
      lastStamp = stamp;
      const result = landmarker.detectForVideo(video, stamp);
      count = record(result, seen, stamp / 1000);
      draw(context, overlay, video, result);
      detections++;
      if (import.meta.env.DEV && stamp - traced > 5000) {
        if (traced > 0) console.info(`[ShadowZoo] camera hands: ${count}, ${((detections * 1000) / (stamp - traced)).toFixed(1)} detections/s`);
        traced = stamp;
        detections = 0;
      }
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(detect);
    else requestAnimationFrame(detect);
  };
  schedule();

  return {
    get count() {
      return count;
    },
    sample(side, stage, out) {
      const hand = seen[side];
      const now = performance.now() / 1000;
      if (stopped || !hand || now - hand.time > lostAfter(interval) || video.videoHeight === 0) {
        filters[side].reset();
        out.tracked = false;
        return;
      }
      // With both hands in view, they move as a pair and keep their true spacing (the bird needs it).
      const other = seen[side === 'left' ? 'right' : 'left'];
      let anchor: { x: number; y: number } | undefined;
      if (other && now - other.time <= lostAfter(interval)) {
        const a = imageCenter(hand.hand.image);
        const b = imageCenter(other.hand.image);
        anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      placeCameraHand(hand.hand, stage, video.videoWidth / video.videoHeight, scratch, anchor);
      filters[side].filter(scratch.pos, now, out.joints.pos);
      out.joints.rad.set(scratch.rad);
      out.tracked = true;
    },
    stop() {
      stopped = true;
      landmarker?.close();
      landmarker = null;
      stopStream();
      context?.clearRect(0, 0, overlay.width, overlay.height);
    },
  };
}

/**
 * Plays the camera stream in the video element. A stream can stall without a first picture; attaching
 * it again restarts it, so give it a few tries.
 */
async function playStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    video.srcObject = stream;
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000));
    if (await Promise.race([video.play().then(() => true), timeout])) return;
    video.srcObject = null;
  }
  throw new DOMException('The camera sent no picture.', 'NotReadableError');
}

/** Hand tracking on the GPU where the browser allows it, otherwise on the CPU. */
async function createLandmarker(): Promise<HandLandmarker> {
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  const fileset = { wasmLoaderPath, wasmBinaryPath };
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

/** Stores the hands in a result by the player's handedness; returns how many were seen. */
function record(result: HandLandmarkerResult, seen: Record<Handedness, Seen | null>, time: number): number {
  const hands = result.landmarks.map((image, i) => ({
    image: image as readonly Point3[],
    world: result.worldLandmarks[i] as readonly Point3[],
    side: handFromLabel(result.handedness[i]?.[0]?.categoryName ?? 'Right'),
  }));
  // Two hands given the same side: the one on the picture's left is the player's right.
  if (hands.length === 2 && hands[0].side === hands[1].side) {
    const [a, b] = hands[0].image[0].x < hands[1].image[0].x ? [0, 1] : [1, 0];
    hands[a].side = 'right';
    hands[b].side = 'left';
  }
  for (const h of hands) seen[h.side] = { hand: { world: h.world, image: h.image }, time };
  return hands.length;
}

/** Draws the tracked hands over the camera picture (the view is mirrored by CSS, like a mirror). */
function draw(context: CanvasRenderingContext2D | null, overlay: HTMLCanvasElement, video: HTMLVideoElement, result: HandLandmarkerResult): void {
  if (!context) return;
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  const w = overlay.width;
  const h = overlay.height;
  context.clearRect(0, 0, w, h);
  context.lineWidth = Math.max(2, w / 160);
  context.strokeStyle = 'rgba(255, 194, 122, 0.9)';
  context.fillStyle = 'rgba(255, 233, 199, 0.95)';
  for (const hand of result.landmarks) {
    context.beginPath();
    for (const [a, b] of LINKS) {
      context.moveTo(hand[a].x * w, hand[a].y * h);
      context.lineTo(hand[b].x * w, hand[b].y * h);
    }
    context.stroke();
    for (const p of hand) {
      context.beginPath();
      context.arc(p.x * w, p.y * h, Math.max(2, w / 200), 0, Math.PI * 2);
      context.fill();
    }
  }
}
