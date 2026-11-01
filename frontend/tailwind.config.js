/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          dark: "#080c14",
          card: "#0f1724",
          hover: "#162032",
          subtle: "#121b2a",
        },
        border: {
          dark: "#1e2c40",
          light: "#2a3d58",
        },
        brand: {
          cyan: "#06b6d4",
          indigo: "#6366f1",
          emerald: "#10b981",
          amber: "#f59e0b",
          rose: "#f43f5e",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      keyframes: {
        slideRight: {
          "0%":   { transform: "translateX(-100%)", opacity: "0.6" },
          "50%":  { transform: "translateX(0%)",    opacity: "1"   },
          "100%": { transform: "translateX(100%)",  opacity: "0.6" },
        },
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)"   },
        },
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 0 2px rgba(34,211,238,0.25)" },
          "50%":       { boxShadow: "0 0 0 4px rgba(34,211,238,0.55)" },
        },
      },
      animation: {
        "slide-right": "slideRight 1.5s ease-in-out infinite",
        "fade-in":     "fadeIn 0.2s ease-out both",
        "glow-pulse":  "glowPulse 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}
