"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  duration?: number;
  onDone?: () => void;
}

export default function Toast({
  message,
  duration = 4000,
  onDone,
}: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDone]);

  if (!visible) return null;

  return (
    <div className="fixed top-16 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded bg-white px-4 py-2 text-center text-sm font-bold text-black shadow-lg animate-fade-in">
      {message}
    </div>
  );
}
