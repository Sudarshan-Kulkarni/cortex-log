import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        manila: {
          DEFAULT: "#F3E9D2",
          card: "#FAF3E3",
          muted: "#E8DCC2",
        },
        ink: {
          DEFAULT: "#1C1B18",
          muted: "#57534E",
        },
        status: {
          green: "#16A34A",
          yellow: "#EAB308",
          red: "#DC2626",
        },
      },
      fontFamily: {
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        blueprint: "2px 2px 0px #1C1B18",
        "blueprint-lg": "4px 4px 0px #1C1B18",
      },
    },
  },
  plugins: [],
};

export default config;
