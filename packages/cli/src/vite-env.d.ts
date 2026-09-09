/// <reference types="vite/client" />
interface ImportMetaEnv {
    VITE_VERSION: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
