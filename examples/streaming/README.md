# Streaming Example (WebCodecs AudioDecoder + Worker)

Streams an MP3 file over HTTP, decodes it progressively using the WebCodecs
`AudioDecoder` API inside a Web Worker, and sends decoded audio directly to
the ClipNode processor via a `MessagePort`.

## Architecture

```
fetch → ReadableStream → MP3 frame parser → AudioDecoder (Worker)
                                               ↓ MessagePort
                                          ClipProcessor (AudioWorklet)
                                               ↓
                                          AudioContext.destination
```

The main thread only handles UI and transport controls.

## Browser Support

Chrome 94+, Edge 94+, Firefox 130+, Safari 26+

```sh
bun run dev
```
