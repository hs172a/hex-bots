/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/web/index.html',
    './src/web/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // SpaceMolt sci-fi theme (з існуючого CSS)
        space: {
          bg: '#0d1117',
          card: '#161b22',
          input: '#0d1117',
          'row-hover': '#1c2128',
          border: '#30363d',
          'border-active': '#58a6ff',
          text: '#c9d1d9',
          'text-dim': '#8b949e',
          'text-bright': '#f0f6fc',
          accent: '#58a6ff',
          green: '#3fb950',
          red: '#f85149',
          yellow: '#d29922',
          cyan: '#39d2c0',
          magenta: '#bc8cff',
          orange: '#db6d28',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
