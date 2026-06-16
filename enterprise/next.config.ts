import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      { source: "/new-crawl", destination: "/crawl-studio", permanent: true },
      { source: "/ai-insights", destination: "/ai-copilot", permanent: true },
      { source: "/analytics", destination: "/competitive-intelligence", permanent: true },
      { source: "/improvements", destination: "/ai-copilot", permanent: true },
      { source: "/comparison", destination: "/competitive-intelligence", permanent: true },
      { source: "/benchmarking", destination: "/competitive-intelligence", permanent: true },
    ]
  },
}

export default nextConfig
