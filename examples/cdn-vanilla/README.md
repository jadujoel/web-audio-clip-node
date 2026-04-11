# CDN Vanilla Example

Zero-install example — serve `index.html` with any static file server.

Everything is loaded from [jsDelivr](https://www.jsdelivr.com/).

> **Note:** Opening the file directly (`file://`) won't work because browsers
> treat `file:` URLs as unique security origins, blocking cross-origin module
> imports.

```sh
bun index.html
```
