// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // exact neon from your logo: #39FF14
      colors: {
        scrbl: "rgb(57 255 20 / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;

