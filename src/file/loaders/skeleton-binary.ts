type SkeletonHeader = {
    boneNames?: string[];
    parents?: {
        file: string;
        format: string;
        count: number;
        stride: number;
    };
};

type StdMaleHeader = {
    stdMaleModel?: {
        restTranslations?: { file: string; count: number; stride: number };
        restRotations?: { file: string; count: number; stride: number };
        parents?: { file: string; count: number; stride: number };
        compTranslations?: { file: string; count: number; stride: number };
        compRotations?: { file: string; count: number; stride: number };
        verts?: { file: string; count: number; stride: number };
    };
};

type SkeletonLibrary = {
    boneNames?: string[];
    skeleton1185Names?: string[];
    parents?: Int32Array;
    stdMaleRestTranslations?: Float32Array;
    stdMaleRestRotations?: Float32Array;
    stdMaleParents?: Int32Array;
    stdMaleCompTranslations?: Float32Array;
    stdMaleCompRotations?: Float32Array;
    stdMaleVerts?: Float32Array;
};

const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
};

const fetchArrayBuffer = async (url: string): Promise<ArrayBuffer> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.arrayBuffer();
};

const readFloat32 = async (baseUrl: string, file: string) => {
    const buffer = await fetchArrayBuffer(`${baseUrl}/${file}`);
    return new Float32Array(buffer);
};

const readInt32 = async (baseUrl: string, file: string) => {
    const buffer = await fetchArrayBuffer(`${baseUrl}/${file}`);
    return new Int32Array(buffer);
};

const loadSkeletonLibrary = async (): Promise<SkeletonLibrary> => {
    const skeletonBase = '/gs/assets/model/441_skeleton/converted';
    const stdMaleBase = '/gs/assets/model/std_male_model/converted';
    const skeleton1185Url = '/gs/assets/1185-skeleton/1185-skeleton.json';

    const skeletonHeader = await fetchJson<SkeletonHeader>(`${skeletonBase}/skeleton_header.json`);
    const stdMaleHeader = await fetchJson<StdMaleHeader>(`${stdMaleBase}/std_male_header.json`);

    const library: SkeletonLibrary = {};

    if (Array.isArray(skeletonHeader.boneNames)) {
        library.boneNames = skeletonHeader.boneNames;
    }

    try {
        const skeleton1185 = await fetchJson<string[]>(skeleton1185Url);
        if (Array.isArray(skeleton1185)) {
            library.skeleton1185Names = skeleton1185;
        }
    } catch (error) {
        // optional file
    }

    if (skeletonHeader.parents?.file) {
        library.parents = await readInt32(skeletonBase, skeletonHeader.parents.file);
    }

    const stdMaleModel = stdMaleHeader.stdMaleModel;
    if (stdMaleModel?.restTranslations?.file) {
        library.stdMaleRestTranslations = await readFloat32(stdMaleBase, stdMaleModel.restTranslations.file);
    }
    if (stdMaleModel?.restRotations?.file) {
        library.stdMaleRestRotations = await readFloat32(stdMaleBase, stdMaleModel.restRotations.file);
    }
    if (stdMaleModel?.parents?.file) {
        library.stdMaleParents = await readInt32(stdMaleBase, stdMaleModel.parents.file);
    }
    if (stdMaleModel?.compTranslations?.file) {
        library.stdMaleCompTranslations = await readFloat32(stdMaleBase, stdMaleModel.compTranslations.file);
    }
    if (stdMaleModel?.compRotations?.file) {
        library.stdMaleCompRotations = await readFloat32(stdMaleBase, stdMaleModel.compRotations.file);
    }
    if (stdMaleModel?.verts?.file) {
        library.stdMaleVerts = await readFloat32(stdMaleBase, stdMaleModel.verts.file);
    }

    return library;
};

export { loadSkeletonLibrary };
export type { SkeletonLibrary };
