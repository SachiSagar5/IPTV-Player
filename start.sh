#!/bin/bash

echo "Starting IPTV Player..."
echo ""
echo "Choose an option:"
echo "1. Development server (npm run dev)"
echo "2. Preview production build (npm run preview)"
echo "3. Build for production (npm run build)"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        echo "Starting development server..."
        npm run dev
        ;;
    2)
        echo "Starting preview server..."
        npm run preview
        ;;
    3)
        echo "Building for production..."
        npm run build
        ;;
    *)
        echo "Invalid choice. Starting development server by default..."
        npm run dev
        ;;
esac