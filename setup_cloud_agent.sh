#!/bin/bash
# GSPC-NEXT Cloud Setup Script (Full Logic Mirror Mode)

set -e 
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Starting GSPC-NEXT Setup (V2 with Full Logic Mirror)...${NC}"

# 1. Create Subdirectory
if [ ! -d "gspc-next" ]; then
    mkdir gspc-next
fi
cd gspc-next

# 2. Setup V2 .gitignore
if [ ! -f ".gitignore" ]; then
    cat > .gitignore <<EOF
node_modules/
dist/
.env
.DS_Store
coverage/
legacy_reference/
EOF
fi

# ==========================================
# 3. MIGRATE EVERYTHING FOR REFERENCE
# ==========================================
echo -e "${BLUE}📦 Creating Legacy Reference Mirror...${NC}"
mkdir -p legacy_reference/api
mkdir -p legacy_reference/config
mkdir -p legacy_reference/public_js
mkdir -p frontend_assets_prep

# Copy API files (Logic Source)
if [ -d "../api" ]; then
    cp ../api/*.php legacy_reference/api/
    echo -e "${GREEN}✔ Mirroring API logic (auth, data, messages, profile, relations)...${NC}"
fi

# Copy Config files (Constants Source)
if [ -d "../config" ]; then
    cp ../config/*.php legacy_reference/config/
    echo -e "${GREEN}✔ Mirroring Config (constants, helpers, etc)...${NC}"
fi

# Copy JS logic (Frontend Logic Source)
if [ -d "../public/js" ]; then
    cp ../public/js/*.js legacy_reference/public_js/
    echo -e "${GREEN}✔ Mirroring Legacy JS (graph.js, ui.js, app.js)...${NC}"
fi

# Copy Assets (Actual Images)
if [ -d "../assets" ]; then
    cp -r ../assets/* frontend_assets_prep/
    echo -e "${GREEN}✔ Prepping Assets...${NC}"
fi

# Copy Favicon
if [ -f "../favicon.svg" ]; then
    cp "../favicon.svg" frontend_assets_prep/
fi

# ==========================================
# 4. INFRASTRUCTURE & SCAFFOLDING
# ==========================================

# Docker Compose
cat > docker-compose.yml <<EOF
version: '3.8'
services:
  db:
    image: mysql:8.0
    container_name: gspc-v2-mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: social_game_db
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql
    command: --default-authentication-plugin=mysql_native_password
    healthcheck:
      test: ["CMD", "mysqladmin" ,"ping", "-h", "localhost"]
      timeout: 20s
      retries: 10
  redis:
    image: redis:alpine
    container_name: gspc-v2-redis
    restart: always
    ports:
      - "6379:6379"
volumes:
  db_data:
EOF

# Backend (NestJS)
if [ ! -d "backend" ]; then
  echo -e "${BLUE}⚙️ Scaffolding Backend...${NC}"
  npx -y @nestjs/cli new backend --package-manager npm --skip-git --strict > /dev/null
  
  cd backend
  echo -e "${BLUE}📥 Installing Backend Deps...${NC}"
  npm install @nestjs/typeorm typeorm mysql2 @nestjs/config @nestjs/jwt passport-jwt
  npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
  npm install class-validator class-transformer redis ioredis bcrypt @types/bcrypt
  
  cat > .env <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=root
DB_DATABASE=social_game_db
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=dev_secret_key_v2_replace_me
EOF
  cd ..
fi

# Frontend (React)
if [ ! -d "frontend" ]; then
  echo -e "${BLUE}🎨 Scaffolding Frontend...${NC}"
  npm create vite@latest frontend -- --template react-ts > /dev/null
  
  cd frontend
  echo -e "${BLUE}📥 Installing Frontend Deps...${NC}"
  npm install
  npm install three @types/three @react-three/fiber @react-three/drei
  npm install react-force-graph-3d three-spritetext
  npm install zustand socket.io-client axios clsx react-router-dom

  # FINAL MOVE: Assets
  echo -e "${BLUE}🖼️ Installing Assets...${NC}"
  mkdir -p public/assets
  cp -r ../frontend_assets_prep/* public/assets/
  
  cd ..
fi

# Cleanup
rm -rf frontend_assets_prep

echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "--------------------------------------------------------"
echo -e "Legacy Logic Mirror: ./gspc-next/legacy_reference/"
echo -e "  (Check this folder to see how profile.php or graph.js was implemented)"
echo -e "--------------------------------------------------------"