/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#0B3D91",
          blue: "#2E8DE6",
          turquoise: "#00B6C8",
          sky: "#E6F7FF",
          ink: "#0A2350",
        },
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
        display: ["Poppins", "system-ui", "sans-serif"],
      },
      boxShadow: { soft: "0 8px 30px -12px rgba(11,61,145,.25)" },
    },
  },
  plugins: [],
};
