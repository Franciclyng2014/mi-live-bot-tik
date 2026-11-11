FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install -U yt-dlp --break-system-packages --no-cache-dir
WORKDIR /app
COPY package*.json ./
RUN npm install && echo "deps installed v2"
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]