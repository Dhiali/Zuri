import { useSyncExternalStore } from "react";

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function stopScreenShare() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video = null;
  emit();
}

// The browser always asks the user for permission and shows its own "sharing" indicator.
export async function startScreenShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This browser does not support screen capture.");
  const next = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true } as DisplayMediaStreamOptions);
  const element = document.createElement("video");
  element.muted = true;
  element.srcObject = next;
  await element.play();
  next.getVideoTracks()[0]?.addEventListener("ended", stopScreenShare);
  stream = next;
  video = element;
  emit();
}

export function grabScreenFrame(maxWidth = 1280): string | null {
  if (!video || !video.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export function useScreenShareActive() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => stream !== null,
    () => false,
  );
}
