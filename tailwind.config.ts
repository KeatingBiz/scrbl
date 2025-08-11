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
      // exact green from your logo image: #2AEF7C
      colors: {
        scrbl: "rgb(42 239 124 / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;




