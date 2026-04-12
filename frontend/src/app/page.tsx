"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Camera,
  Gauge,
  History,
  Images,
  Play,
  Shield,
  Siren,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  ScanLine,
  Radar,
  Cpu,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type CameraState = "idle" | "starting" | "live" | "error";
type BackendHealthState = "checking" | "online" | "offline";

type PredictionResponse = {
  label: string;
  confidence: number;
  reason?: string;
};

type EventItem = {
  id: number;
  title: string;
  detail: string;
  time: string;
  level: "normal" | "warning" | "critical";
};

type IncidentItem = {
  id: number;
  time: string;
  reason: string;
  confidence: string;
  image: string;
};

type PanelKey = "telemetry" | "timeline" | "incidents" | "alert";

export default function Home() {
  const backendBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

  const dashboardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestInFlightRef = useRef(false);
  const previousStatusRef = useRef<string>("");
  const lastIncidentSignatureRef = useRef<string>("");
  const previousBackendStatusRef = useRef<BackendHealthState>("checking");

  const audioContextRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [backendStatus, setBackendStatus] =
    useState<BackendHealthState>("checking");
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<PanelKey, boolean>>({
    telemetry: false,
    timeline: false,
    incidents: false,
    alert: false,
  });

  const [errorMessage, setErrorMessage] = useState("");
  const [driverState, setDriverState] = useState("Waiting");
  const [confidence, setConfidence] = useState("0%");
  const [detectionReason, setDetectionReason] = useState("Monitoring");
  const [isPredicting, setIsPredicting] = useState(false);
  const [alarmMuted, setAlarmMuted] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);

  const isAlert = driverState === "Drowsy";

  const numericConfidence = useMemo(() => {
    const parsed = Number(confidence.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }, [confidence]);

  const fatigueLevel = useMemo(() => {
    if (backendStatus === "offline") return "Offline";
    if (isAlert && numericConfidence >= 85) return "Critical";
    if (isAlert) return "Warning";
    if (driverState === "No Face") return "Watch";
    if (cameraState === "live") return "Normal";
    return "Standby";
  }, [backendStatus, isAlert, numericConfidence, driverState, cameraState]);

  const statusRingTone = useMemo<"green" | "orange" | "red" | "zinc">(() => {
    if (backendStatus === "offline") return "red";
    if (isAlert) return "red";
    if (cameraState === "starting") return "orange";
    if (cameraState === "live") return "green";
    return "zinc";
  }, [backendStatus, isAlert, cameraState]);

  const showSidebar = sidebarVisible && !focusMode;

  const getNowTime = () => {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const addEvent = (
    title: string,
    detail: string,
    level: "normal" | "warning" | "critical"
  ) => {
    setEvents((prev) =>
      [
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          title,
          detail,
          time: getNowTime(),
          level,
        },
        ...prev,
      ].slice(0, 8)
    );
  };

  const addIncident = (
    reason: string,
    confidenceLabel: string,
    image: string
  ) => {
    setIncidents((prev) =>
      [
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          time: getNowTime(),
          reason,
          confidence: confidenceLabel,
          image,
        },
        ...prev,
      ].slice(0, 4)
    );
  };

  const captureIncidentSnapshot = (
    reason: string,
    confidenceLabel: string
  ) => {
    if (!videoRef.current) return;
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.82);

    addIncident(reason, confidenceLabel, image);
  };

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  };

  const playBeep = () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(980, audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.45,
      audioContext.currentTime + 0.02
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.35
    );

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.36);
  };

  const startAlarm = () => {
    if (alarmIntervalRef.current !== null) return;

    playBeep();
    alarmIntervalRef.current = window.setInterval(() => {
      playBeep();
    }, 700);
  };

  const stopAlarm = () => {
    if (alarmIntervalRef.current !== null) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  };

  const checkBackendHealth = async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/health`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        setBackendStatus("online");
      } else {
        setBackendStatus("offline");
      }
    } catch {
      setBackendStatus("offline");
    }
  };

  const attachStreamToVideo = async () => {
    if (!videoRef.current || !streamRef.current) return;

    try {
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();
    } catch (error) {
      console.error("Video play error:", error);
    }
  };

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement && dashboardRef.current) {
        await dashboardRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
    }
  };

  const togglePanel = (panel: PanelKey) => {
    setCollapsedPanels((prev) => ({
      ...prev,
      [panel]: !prev[panel],
    }));
  };

  const startCamera = async () => {
    try {
      await ensureAudioContext();

      setCameraState("starting");
      setErrorMessage("");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraState("live");
      addEvent("Monitoring Started", "Live camera stream connected.", "normal");
    } catch (error) {
      console.error(error);
      setCameraState("error");
      setErrorMessage("Camera access was denied or unavailable.");
      addEvent("Camera Error", "Camera access failed or was denied.", "warning");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    stopAlarm();
    setCameraState("idle");
    setErrorMessage("");
    setDriverState("Waiting");
    setConfidence("0%");
    setDetectionReason("Monitoring");
    previousStatusRef.current = "";
    lastIncidentSignatureRef.current = "";
    addEvent("Monitoring Stopped", "Driver monitoring session ended.", "warning");
  };

  const captureFrameAndPredict = async () => {
    if (requestInFlightRef.current) return;
    if (!videoRef.current) return;
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
      return;
    }

    try {
      requestInFlightRef.current = true;
      setIsPredicting(true);

      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;

      const context = canvas.getContext("2d");
      if (!context) return;

      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.9);
      });

      if (!blob) return;

      const formData = new FormData();
      formData.append("file", blob, "frame.jpg");

      const response = await fetch(`${backendBaseUrl}/predict`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Prediction request failed");
      }

      setBackendStatus("online");

      const data: PredictionResponse = await response.json();

      setDriverState(data.label ?? "Unknown");
      setDetectionReason(data.reason ?? "Monitoring");

      const percentage =
        typeof data.confidence === "number"
          ? `${Math.round(data.confidence * 100)}%`
          : "0%";

      setConfidence(percentage);
    } catch (error) {
      console.error("Prediction error:", error);
      setBackendStatus("offline");
      setDetectionReason("Backend connection issue");
    } finally {
      requestInFlightRef.current = false;
      setIsPredicting(false);
    }
  };

  useEffect(() => {
    checkBackendHealth();

    const interval = setInterval(() => {
      checkBackendHealth();
    }, 5000);

    return () => clearInterval(interval);
  }, [backendBaseUrl]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (previousBackendStatusRef.current === backendStatus) return;

    if (backendStatus === "online") {
      addEvent("Backend Online", "Prediction API is reachable.", "normal");
    } else if (backendStatus === "offline") {
      addEvent("Backend Offline", "Prediction API is not reachable.", "warning");
    }

    previousBackendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    if (cameraState === "live") {
      const timer = setTimeout(() => {
        attachStreamToVideo();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [cameraState]);

  useEffect(() => {
    if (cameraState !== "live") return;

    const initialTimer = setTimeout(() => {
      captureFrameAndPredict();
    }, 600);

    const interval = setInterval(() => {
      captureFrameAndPredict();
    }, 500);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [cameraState]);

  useEffect(() => {
    if (isAlert && !alarmMuted) {
      startAlarm();
    } else {
      stopAlarm();
    }
  }, [isAlert, alarmMuted]);

  useEffect(() => {
    if (cameraState !== "live") return;

    const currentSignature = `${driverState}::${detectionReason}`;

    if (
      currentSignature === previousStatusRef.current ||
      driverState === "Waiting"
    ) {
      return;
    }

    previousStatusRef.current = currentSignature;

    if (driverState === "Drowsy") {
      addEvent("Drowsiness Detected", detectionReason, "critical");
    } else if (driverState === "No Face") {
      addEvent("Face Lost", "Driver face is not clearly visible.", "warning");
    } else if (driverState === "Non Drowsy") {
      addEvent("Driver Attentive", detectionReason, "normal");
    }
  }, [driverState, detectionReason, cameraState]);

  useEffect(() => {
    if (cameraState !== "live") return;

    if (driverState === "Drowsy") {
      const signature = `${driverState}::${detectionReason}`;

      if (signature !== lastIncidentSignatureRef.current) {
        lastIncidentSignatureRef.current = signature;
        captureIncidentSnapshot(detectionReason, confidence);
      }
    } else {
      lastIncidentSignatureRef.current = "";
    }
  }, [driverState, detectionReason, confidence, cameraState]);

  useEffect(() => {
    return () => {
      stopAlarm();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const systemValue =
    backendStatus === "offline"
      ? "API Down"
      : cameraState === "live"
        ? isAlert
          ? "Alert"
          : "Active"
        : cameraState === "starting"
          ? "Booting"
          : cameraState === "error"
            ? "Warning"
            : "Armed";

  const cameraValue =
    cameraState === "live"
      ? "Live"
      : cameraState === "starting"
        ? "Starting"
        : cameraState === "error"
          ? "Blocked"
          : "Ready";

  const alertValue =
    isAlert
      ? "Triggered"
      : cameraState === "error" || backendStatus === "offline"
        ? "Check"
        : "Standby";

  const stabilityValue =
    backendStatus === "offline"
      ? "Offline"
      : isAlert
        ? "Critical"
        : isPredicting
          ? "Scanning"
          : "Optimal";

  const cameraStatusText =
    cameraState === "live"
      ? "Streaming"
      : cameraState === "starting"
        ? "Starting"
        : cameraState === "error"
          ? "Unavailable"
          : "Waiting";

  const backendStatusText =
    backendStatus === "online"
      ? "Online"
      : backendStatus === "offline"
        ? "Offline"
        : "Checking";

  return (
    <main className="min-h-screen bg-[#070708] text-white">
      <div
        ref={dashboardRef}
        className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.16),_transparent_20%),radial-gradient(circle_at_bottom_right,_rgba(239,68,68,0.08),_transparent_16%),linear-gradient(180deg,_#131416_0%,_#0a0a0b_100%)]"
      >
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
          <motion.header
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="mb-8 overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.04] shadow-[0_24px_100px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          >
            <div className="grid gap-8 p-6 lg:grid-cols-[1.25fr_0.95fr] lg:p-8">
              <div>
                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <motion.div
                    whileHover={{ y: -1 }}
                    className="inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-400/10 px-4 py-2 text-sm font-medium text-orange-300"
                  >
                    <Sparkles className="h-4 w-4" />
                    Premium Automotive Safety Interface
                  </motion.div>

                  <motion.div
                    whileHover={{ y: -1 }}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
                      backendStatus === "online"
                        ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : backendStatus === "offline"
                          ? "border border-red-400/20 bg-red-500/10 text-red-300"
                          : "border border-white/10 bg-white/5 text-zinc-300"
                    }`}
                  >
                    Backend API • {backendStatusText}
                  </motion.div>
                </div>

                <motion.h1
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.06 }}
                  className="max-w-4xl text-[2.6rem] font-semibold tracking-[-0.04em] text-white md:text-[4.25rem] md:leading-[1.02]"
                >
                  Driver Drowsiness
                  <span className="mt-2 block bg-gradient-to-r from-white via-orange-200 to-orange-500 bg-clip-text text-transparent">
                    Monitoring Console
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.12 }}
                  className="mt-5 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base"
                >
                  A luxury cockpit-inspired AI surveillance experience for
                  real-time fatigue detection, intelligent alerts, and smooth
                  operator awareness.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.18 }}
                  className="mt-8 flex flex-wrap gap-3"
                >
                  <Pill>Real-Time Monitoring</Pill>
                  <Pill tone="orange">Safety Alert Ready</Pill>
                  <Pill tone="red">High Priority Detection</Pill>
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.08 }}
                className="grid grid-cols-2 gap-4"
              >
                <StatCard
                  title="System"
                  value={systemValue}
                  icon={<Shield className="h-5 w-5" />}
                />
                <StatCard
                  title="Camera"
                  value={cameraValue}
                  icon={<Camera className="h-5 w-5" />}
                />
                <StatCard
                  title="Alerts"
                  value={alertValue}
                  icon={<Siren className="h-5 w-5" />}
                />
                <StatCard
                  title="Stability"
                  value={stabilityValue}
                  icon={<Activity className="h-5 w-5" />}
                />
              </motion.div>
            </div>
          </motion.header>

          <AnimatePresence>
            {isAlert && (
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.28 }}
                className="mb-6 rounded-[28px] border border-red-500/40 bg-red-500/15 px-6 py-4 shadow-[0_0_45px_rgba(239,68,68,0.18)]"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-red-300">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.2em] text-red-200/80">
                      Critical Alert
                    </p>
                    <h3 className="text-lg font-semibold text-white">
                      Drowsiness detected. Driver attention required.
                    </h3>
                    <p className="mt-1 text-sm text-red-200/80">
                      Trigger reason: {detectionReason}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <section
            className={`grid flex-1 gap-6 ${
              showSidebar ? "lg:grid-cols-[1.55fr_0.82fr]" : "grid-cols-1"
            }`}
          >
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: 0.08 }}
              className="rounded-[32px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.40)] backdrop-blur-xl"
            >
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-orange-300/70">
                    Live Vision Panel
                  </p>
                  <h2 className="mt-2 text-[1.8rem] font-semibold tracking-[-0.03em] text-white">
                    Driver Camera Feed
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setSidebarVisible((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {showSidebar ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRightOpen className="h-4 w-4" />
                    )}
                    {showSidebar ? "Hide Panels" : "Show Panels"}
                  </motion.button>

                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setFocusMode((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {focusMode ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                    {focusMode ? "Exit Focus" : "Focus Mode"}
                  </motion.button>

                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={toggleBrowserFullscreen}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {isBrowserFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                    {isBrowserFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  </motion.button>

                  <motion.div
                    animate={isAlert ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                    transition={
                      isAlert
                        ? { duration: 1.1, repeat: Infinity }
                        : { duration: 0.2 }
                    }
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      cameraState === "live"
                        ? isAlert
                          ? "border border-red-500/30 bg-red-500/10 text-red-300"
                          : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : cameraState === "starting"
                          ? "border border-orange-400/20 bg-orange-400/10 text-orange-300"
                          : cameraState === "error"
                            ? "border border-red-400/20 bg-red-500/10 text-red-300"
                            : "border border-white/10 bg-white/5 text-zinc-300"
                    }`}
                  >
                    {cameraState === "live"
                      ? isAlert
                        ? "Drowsiness Detected"
                        : "Camera Live"
                      : cameraState === "starting"
                        ? "Starting Camera"
                        : cameraState === "error"
                          ? "Camera Error"
                          : "Ready to Connect"}
                  </motion.div>
                </div>
              </div>

              <div
                className={`relative overflow-hidden rounded-[30px] bg-[#040404] ${
                  isAlert
                    ? "border border-red-500 shadow-[0_0_45px_rgba(239,68,68,0.24)]"
                    : "border border-white/10"
                }`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.16),_transparent_26%),linear-gradient(135deg,_rgba(255,255,255,0.03),_transparent_46%)]" />

                <div
                  className={`relative ${
                    focusMode || !showSidebar ? "aspect-[16/9] lg:aspect-[18/9]" : "aspect-video"
                  }`}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`h-full w-full object-cover ${
                      cameraState === "live" ? "block" : "hidden"
                    }`}
                  />

                  {cameraState === "live" && (
                    <motion.div
                      className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-transparent via-orange-400/10 to-transparent"
                      animate={{ x: ["-20%", "130%"] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
                    />
                  )}

                  {cameraState !== "live" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.div
                        initial={{ opacity: 0.8, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35 }}
                        className="text-center"
                      >
                        <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-orange-400/20 bg-orange-400/10 shadow-[0_0_40px_rgba(249,115,22,0.18)]">
                          <Camera className="h-10 w-10 text-orange-300" />
                        </div>

                        <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                          {cameraState === "starting"
                            ? "Starting Camera"
                            : cameraState === "error"
                              ? "Camera Access Failed"
                              : "Camera Module Ready"}
                        </h3>

                        <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-zinc-400">
                          {cameraState === "error"
                            ? errorMessage
                            : "Start the camera to begin the live monitoring experience."}
                        </p>
                      </motion.div>
                    </div>
                  )}

                  <div className="absolute right-5 top-5">
                    <StatusRing
                      tone={statusRingTone}
                      label={
                        backendStatus === "offline"
                          ? "API"
                          : isAlert
                            ? "ALERT"
                            : cameraState === "live"
                              ? "LIVE"
                              : cameraState === "starting"
                                ? "BOOT"
                                : "IDLE"
                      }
                      value={`${numericConfidence}%`}
                      spinning={cameraState === "live" || cameraState === "starting"}
                      pulsing={isAlert}
                    />
                  </div>

                  {isAlert && cameraState === "live" && (
                    <>
                      <div className="absolute inset-0 border-[3px] border-red-500/70" />
                      <div className="absolute left-4 top-4 rounded-full border border-red-400/30 bg-red-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-200 backdrop-blur-md">
                        Alert • {detectionReason}
                      </div>
                    </>
                  )}

                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="rounded-full border border-white/10 bg-black/45 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-300 backdrop-blur-md">
                      {cameraState === "live"
                        ? "Live Stream Active"
                        : "Live Stream Offline"}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {cameraState !== "live" ? (
                        <motion.button
                          whileHover={{ y: -1, scale: 1.01 }}
                          whileTap={{ scale: 0.985 }}
                          onClick={startCamera}
                          className="inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-400/10 px-5 py-3 text-sm font-medium text-orange-300 transition hover:bg-orange-400/15"
                        >
                          <Play className="h-4 w-4" />
                          Start Camera
                        </motion.button>
                      ) : (
                        <>
                          <motion.button
                            whileHover={{ y: -1, scale: 1.01 }}
                            whileTap={{ scale: 0.985 }}
                            onClick={stopCamera}
                            className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300 transition hover:bg-red-500/15"
                          >
                            <Square className="h-4 w-4" />
                            Stop Camera
                          </motion.button>

                          <motion.button
                            whileHover={{ y: -1, scale: 1.01 }}
                            whileTap={{ scale: 0.985 }}
                            onClick={() => setAlarmMuted((prev) => !prev)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                          >
                            {alarmMuted ? (
                              <VolumeX className="h-4 w-4" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
                            )}
                            {alarmMuted ? "Alarm Muted" : "Mute Alarm"}
                          </motion.button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-orange-300/70">
                      Live Intelligence Strip
                    </p>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-white">
                      Real-Time Session Insights
                    </h3>
                  </div>

                  <div className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.22em] text-zinc-300">
                    cockpit view
                  </div>
                </div>

                <div
                  className={`grid gap-4 ${
                    focusMode || !showSidebar
                      ? "md:grid-cols-2 xl:grid-cols-4"
                      : "md:grid-cols-2 2xl:grid-cols-4"
                  }`}
                >
                  <ConfidenceMeterCard
                    value={numericConfidence}
                    label={driverState}
                    isAlert={isAlert}
                  />

                  <LevelCard level={fatigueLevel} reason={detectionReason} />

                  <InsightCard
                    icon={<Radar className="h-5 w-5" />}
                    title="Sensor Health"
                    rows={[
                      { label: "Camera", value: cameraStatusText },
                      {
                        label: "Prediction",
                        value: isPredicting ? "Scanning" : "Stable",
                      },
                      {
                        label: "Face Feed",
                        value: driverState === "No Face" ? "Lost" : "Visible",
                      },
                    ]}
                  />

                  <InsightCard
                    icon={<Cpu className="h-5 w-5" />}
                    title="Session Summary"
                    rows={[
                      { label: "Events", value: `${events.length}` },
                      { label: "Incidents", value: `${incidents.length}` },
                      {
                        label: "Alarm",
                        value: alarmMuted ? "Muted" : isAlert ? "Active" : "Armed",
                      },
                    ]}
                  />
                </div>
              </div>
            </motion.div>

            <AnimatePresence initial={false}>
              {showSidebar && (
                <motion.div
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.28 }}
                  className="grid gap-6"
                >
                  <CollapsiblePanelCard
                    icon={<Gauge className="h-5 w-5" />}
                    eyebrow="System Telemetry"
                    title="Monitoring Status"
                    collapsed={collapsedPanels.telemetry}
                    onToggle={() => togglePanel("telemetry")}
                  >
                    <div className="space-y-4">
                      <InfoRow label="Driver State" value={driverState} />
                      <InfoRow label="Confidence" value={confidence} />
                      <InfoRow label="Trigger Reason" value={detectionReason} />
                      <InfoRow label="Camera Status" value={cameraStatusText} />
                      <InfoRow label="Backend API" value={backendStatusText} />
                      <InfoRow
                        label="Alarm Engine"
                        value={alarmMuted ? "Muted" : isAlert ? "Beeping" : "Armed"}
                      />
                    </div>
                  </CollapsiblePanelCard>

                  <CollapsiblePanelCard
                    icon={<History className="h-5 w-5" />}
                    eyebrow="Live Activity"
                    title="Event Timeline"
                    collapsed={collapsedPanels.timeline}
                    onToggle={() => togglePanel("timeline")}
                  >
                    <div className="space-y-3">
                      {events.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                          No events yet. Start monitoring to begin tracking.
                        </div>
                      ) : (
                        <AnimatePresence initial={false}>
                          {events.map((event) => (
                            <EventRow key={event.id} event={event} />
                          ))}
                        </AnimatePresence>
                      )}
                    </div>
                  </CollapsiblePanelCard>

                  <CollapsiblePanelCard
                    icon={<Images className="h-5 w-5" />}
                    eyebrow="Captured Evidence"
                    title="Recent Incidents"
                    collapsed={collapsedPanels.incidents}
                    onToggle={() => togglePanel("incidents")}
                  >
                    <div className="space-y-4">
                      {incidents.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                          No incidents captured yet.
                        </div>
                      ) : (
                        <AnimatePresence initial={false}>
                          {incidents.map((incident) => (
                            <IncidentRow key={incident.id} incident={incident} />
                          ))}
                        </AnimatePresence>
                      )}
                    </div>
                  </CollapsiblePanelCard>

                  <CollapsiblePanelCard
                    icon={<AlertTriangle className="h-5 w-5" />}
                    eyebrow="Critical Response"
                    title="Drowsiness Alert Engine"
                    collapsed={collapsedPanels.alert}
                    onToggle={() => togglePanel("alert")}
                    danger
                  >
                    <p className="text-sm leading-7 text-zinc-300">
                      This panel reacts to both prolonged eye closure and downward
                      sleeping posture detection from the backend.
                    </p>

                    <div
                      className={`mt-5 rounded-2xl px-4 py-4 text-sm ${
                        isAlert
                          ? "border border-red-500/40 bg-red-500/15 text-red-200"
                          : "border border-red-400/20 bg-black/20 text-red-200"
                      }`}
                    >
                      Current mode:{" "}
                      {isAlert ? `alert active • ${detectionReason}` : "passive standby"}
                    </div>
                  </CollapsiblePanelCard>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </div>
    </main>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "orange" | "red";
}) {
  const classes =
    tone === "orange"
      ? "border border-orange-400/20 bg-orange-400/10 text-orange-300"
      : tone === "red"
        ? "border border-red-400/20 bg-red-500/10 text-red-300"
        : "border border-white/10 bg-white/5 text-zinc-300";

  return (
    <span className={`rounded-full px-4 py-2 text-sm ${classes}`}>
      {children}
    </span>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ duration: 0.18 }}
      className="rounded-[28px] border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-orange-300">
        {icon}
      </div>
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
        {title}
      </p>
      <motion.p
        key={value}
        initial={{ opacity: 0.65, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white"
      >
        {value}
      </motion.p>
    </motion.div>
  );
}

function CollapsiblePanelCard({
  icon,
  eyebrow,
  title,
  children,
  collapsed,
  onToggle,
  danger = false,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  children: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  danger?: boolean;
}) {
  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={`rounded-[32px] border p-6 shadow-[0_20px_80px_rgba(0,0,0,0.40)] backdrop-blur-xl ${
        danger
          ? "border-red-500/15 bg-[linear-gradient(180deg,rgba(127,29,29,0.22)_0%,rgba(24,24,27,0.55)_100%)] shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
          : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-2xl p-3 ${
              danger
                ? "border border-red-400/20 bg-red-500/10 text-red-300"
                : "border border-orange-400/20 bg-orange-400/10 text-orange-300"
            }`}
          >
            {icon}
          </div>
          <div>
            <p className="text-sm text-zinc-400">{eyebrow}</p>
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
              {title}
            </h3>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onToggle}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm text-white transition hover:bg-white/10"
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      layout
      className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
    >
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </motion.div>
  );
}

function EventRow({ event }: { event: EventItem }) {
  const levelStyles =
    event.level === "critical"
      ? "border-red-500/30 bg-red-500/10"
      : event.level === "warning"
        ? "border-orange-400/20 bg-orange-400/10"
        : "border-white/10 bg-black/20";

  const badgeStyles =
    event.level === "critical"
      ? "text-red-300"
      : event.level === "warning"
        ? "text-orange-300"
        : "text-emerald-300";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22 }}
      className={`rounded-2xl border px-4 py-4 ${levelStyles}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{event.title}</p>
        <span className={`text-xs font-medium ${badgeStyles}`}>{event.time}</span>
      </div>
      <p className="text-sm text-zinc-400">{event.detail}</p>
    </motion.div>
  );
}

function IncidentRow({ incident }: { incident: IncidentItem }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22 }}
      className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
    >
      <div className="aspect-video w-full overflow-hidden bg-black">
        <img
          src={incident.image}
          alt={incident.reason}
          className="h-full w-full object-cover transition duration-500 hover:scale-[1.02]"
        />
      </div>

      <div className="space-y-2 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">{incident.reason}</p>
          <span className="text-xs text-orange-300">{incident.time}</span>
        </div>

        <p className="text-sm text-zinc-400">
          Captured at {incident.confidence} confidence.
        </p>
      </div>
    </motion.div>
  );
}

function InsightCard({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className="rounded-[28px] border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-400/10 text-orange-300">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            live data
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
          >
            <span className="text-sm text-zinc-400">{row.label}</span>
            <span className="text-sm font-semibold text-white">{row.value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function ConfidenceMeterCard({
  value,
  label,
  isAlert,
}: {
  value: number;
  label: string;
  isAlert: boolean;
}) {
  const meterWidth = Math.max(8, Math.min(100, value));
  const barClass = isAlert
    ? "from-red-400 via-orange-400 to-red-500"
    : "from-emerald-300 via-orange-300 to-orange-500";

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className="rounded-[28px] border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-400/10 text-orange-300">
          <ScanLine className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Confidence Meter</p>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            live confidence
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-end justify-between">
        <motion.p
          key={value}
          initial={{ opacity: 0.7, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-3xl font-semibold tracking-[-0.04em] text-white"
        >
          {value}%
        </motion.p>
        <span className="text-sm text-zinc-400">{label}</span>
      </div>

      <div className="h-3 overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${meterWidth}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className={`h-full rounded-full bg-gradient-to-r ${barClass}`}
        />
      </div>

      <p className="mt-3 text-sm text-zinc-400">
        Confidence rises with stronger live prediction evidence.
      </p>
    </motion.div>
  );
}

function LevelCard({
  level,
  reason,
}: {
  level: string;
  reason: string;
}) {
  const tone =
    level === "Critical"
      ? {
          badge: "border-red-500/30 bg-red-500/10 text-red-300",
          glow: "shadow-[0_0_30px_rgba(239,68,68,0.12)]",
        }
      : level === "Warning" || level === "Watch"
        ? {
            badge: "border-orange-400/20 bg-orange-400/10 text-orange-300",
            glow: "shadow-[0_0_30px_rgba(249,115,22,0.10)]",
          }
        : level === "Offline"
          ? {
              badge: "border-red-500/30 bg-red-500/10 text-red-300",
              glow: "shadow-[0_0_30px_rgba(239,68,68,0.10)]",
            }
          : {
              badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
              glow: "shadow-[0_0_30px_rgba(16,185,129,0.10)]",
            };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={`rounded-[28px] border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${tone.glow}`}
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-400/10 text-orange-300">
          <Gauge className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Fatigue Level</p>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            adaptive risk
          </p>
        </div>
      </div>

      <div
        className={`inline-flex rounded-full border px-4 py-2 text-sm font-medium ${tone.badge}`}
      >
        {level}
      </div>

      <p className="mt-4 text-sm text-zinc-400">
        Current reason: <span className="text-white">{reason}</span>
      </p>
    </motion.div>
  );
}

function StatusRing({
  tone,
  label,
  value,
  spinning,
  pulsing,
}: {
  tone: "green" | "orange" | "red" | "zinc";
  label: string;
  value: string;
  spinning: boolean;
  pulsing: boolean;
}) {
  const toneMap = {
    green: {
      ring: "border-emerald-400/50",
      glow: "bg-emerald-400/10 text-emerald-300",
      dot: "bg-emerald-400",
    },
    orange: {
      ring: "border-orange-400/50",
      glow: "bg-orange-400/10 text-orange-300",
      dot: "bg-orange-400",
    },
    red: {
      ring: "border-red-400/50",
      glow: "bg-red-500/10 text-red-300",
      dot: "bg-red-400",
    },
    zinc: {
      ring: "border-white/15",
      glow: "bg-white/5 text-zinc-300",
      dot: "bg-zinc-400",
    },
  }[tone];

  return (
    <motion.div
      animate={pulsing ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={pulsing ? { duration: 1.1, repeat: Infinity } : { duration: 0.2 }}
      className={`relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-black/45 backdrop-blur-md ${toneMap.glow}`}
    >
      <motion.div
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={
          spinning
            ? { duration: 4.2, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        className={`absolute inset-[6px] rounded-full border-2 border-dashed ${toneMap.ring}`}
      />

      <motion.div
        animate={spinning ? { rotate: -360 } : { rotate: 0 }}
        transition={
          spinning
            ? { duration: 6.2, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        className={`absolute inset-[14px] rounded-full border ${toneMap.ring}`}
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className={`mb-2 h-2.5 w-2.5 rounded-full ${toneMap.dot}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">
          {label}
        </span>
        <span className="mt-1 text-sm font-semibold text-white">{value}</span>
      </div>
    </motion.div>
  );
}