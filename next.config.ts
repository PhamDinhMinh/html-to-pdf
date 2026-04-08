import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/video": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/story": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
