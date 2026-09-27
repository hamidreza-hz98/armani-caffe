#!/bin/sh
set -eu

export MC_CONFIG_DIR=/tmp/armani-mc
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$MINIO_MEDIA_BUCKET"
mc anonymous set none "local/$MINIO_MEDIA_BUCKET"
mc admin config set local api "cors_allow_origin=$MINIO_CORS_ORIGINS"
mc admin service restart local --wait
mc stat "local/$MINIO_MEDIA_BUCKET"
mc anonymous get "local/$MINIO_MEDIA_BUCKET"
mc admin config get local api
