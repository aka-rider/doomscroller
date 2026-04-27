FROM curlimages/curl AS downloader
WORKDIR /model
RUN --mount=type=cache,target=/root/.cache \
    curl -L -o nomic.gguf "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.f16.gguf"

FROM ghcr.io/ggml-org/llama.cpp:server
COPY --from=downloader /model/nomic.gguf /model/nomic.gguf

EXPOSE 8081

CMD ["-m", "/model/nomic.gguf", "--embedding", "--pooling", "mean", "--ctx-size", "32768", "--batch-size", "8192", "--parallel", "8", "--port", "8081", "--host", "0.0.0.0"]
