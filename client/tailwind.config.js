// tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        outfit: ['"Outfit"', 'sans-serif'],
        parisienne: ['"Parisienne"', 'cursive'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography')
  ],
};
