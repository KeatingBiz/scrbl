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
      // exact neon from the logo
      colors: {
        scrbl: "rgb(57 255 20 / <alpha-value>)", // #39FF14
      },
    },
  },
  plugins: [],
};

export default config;



