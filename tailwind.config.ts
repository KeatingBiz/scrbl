import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        scrbl: '#39FF14', // neon
        charcoal: '#111111',
        surface: '#0A0A0A'
      }
    }
  },
  plugins: []
} satisfies Config
