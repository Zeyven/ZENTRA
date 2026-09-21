/** @type {import('tailwindcss').Config} */
module.exports = {
  content: { relative: true, files: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f5ee',
          100: '#dce9d9',
          200: '#bdd5bf',
          300: '#95b89e',
          400: '#6f987d',
          500: '#507d62',
          600: '#315e50',
          700: '#294e40',
          800: '#203f34',
          900: '#18332a'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
      }
    }
  },
  plugins: []
}
