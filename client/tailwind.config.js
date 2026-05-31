/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--primary)', hover: '#1253d8' },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger:  'var(--danger)',
      },
    },
  },
  plugins: [],
};
