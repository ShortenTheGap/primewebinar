/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        card: '#1a1a1a',
        'card-cro': '#141414',
        border: '#2a2a2a',
        muted: '#6b7280',
        teal: '#2dd4bf',
        green: '#4ade80',
        amber: '#f59e0b',
        purple: '#a78bfa',
      },
    },
  },
  plugins: [],
};
