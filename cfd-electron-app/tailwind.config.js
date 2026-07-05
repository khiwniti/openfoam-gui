/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          50: '#f7f8fa',
          100: '#eef1f5',
          200: '#dde3eb',
          300: '#c0c9d6',
          800: '#1a1d23',
          900: '#0f1115',
          950: '#0a0c0f',
        },
        brand: {
          50: '#e7f5ff',
          100: '#cfebff',
          400: '#3aa7ff',
          500: '#1a8aff',
          600: '#006bd6',
          700: '#0057ad',
        },
        accent: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
