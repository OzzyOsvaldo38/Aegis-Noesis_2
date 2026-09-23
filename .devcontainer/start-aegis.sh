#!/bin/bash
if ! curl -sf http://localhost:8080 >/dev/null 2>&1; then
	nohup npm run dev -- --host 0.0.0.0 > /tmp/aegis-vite.log 2>&1 &
fi