declare module "gifsicle-wasm-browser" {
  const gifsicle: {
    run(options: {
      input: { file: File | Blob | ArrayBuffer | string; name: string }[];
      command: string[];
      isStrict?: boolean;
    }): Promise<File[]>;
  };
  export default gifsicle;
}

declare module "@jsquash/avif/encode.js" {
  export default function encode(
    data: ImageData,
    options?: { quality?: number; speed?: number },
  ): Promise<ArrayBuffer>;
}
