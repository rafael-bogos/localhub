export namespace docker {
	
	export class CleanupOptions {
	    containers: boolean;
	    images: boolean;
	    networks: boolean;
	    buildCache: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CleanupOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.containers = source["containers"];
	        this.images = source["images"];
	        this.networks = source["networks"];
	        this.buildCache = source["buildCache"];
	    }
	}
	export class CleanupResult {
	    containersRemoved: number;
	    imagesRemoved: number;
	    networksRemoved: number;
	    buildCacheRemoved: number;
	    spaceMB: number;
	
	    static createFrom(source: any = {}) {
	        return new CleanupResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.containersRemoved = source["containersRemoved"];
	        this.imagesRemoved = source["imagesRemoved"];
	        this.networksRemoved = source["networksRemoved"];
	        this.buildCacheRemoved = source["buildCacheRemoved"];
	        this.spaceMB = source["spaceMB"];
	    }
	}
	export class ContainerInfo {
	    id: string;
	    name: string;
	    image: string;
	    status: string;
	    state: string;
	    ports: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.status = source["status"];
	        this.state = source["state"];
	        this.ports = source["ports"];
	    }
	}
	export class ContainerStats {
	    id: string;
	    cpuPercent: number;
	    memUsage: number;
	    memLimit: number;
	    memPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new ContainerStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memUsage = source["memUsage"];
	        this.memLimit = source["memLimit"];
	        this.memPercent = source["memPercent"];
	    }
	}
	export class ImageInfo {
	    id: string;
	    repository: string;
	    tag: string;
	    size: string;
	    created: string;
	
	    static createFrom(source: any = {}) {
	        return new ImageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.repository = source["repository"];
	        this.tag = source["tag"];
	        this.size = source["size"];
	        this.created = source["created"];
	    }
	}
	export class LogLine {
	    ts: string;
	    stream: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new LogLine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ts = source["ts"];
	        this.stream = source["stream"];
	        this.text = source["text"];
	    }
	}
	export class OlderLogs {
	    lines: LogLine[];
	    hasMore: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OlderLogs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lines = this.convertValues(source["lines"], LogLine);
	        this.hasMore = source["hasMore"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PortOwner {
	    protocol: string;
	    port: number;
	    containerId: string;
	    containerName: string;
	
	    static createFrom(source: any = {}) {
	        return new PortOwner(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.protocol = source["protocol"];
	        this.port = source["port"];
	        this.containerId = source["containerId"];
	        this.containerName = source["containerName"];
	    }
	}
	export class PruneResult {
	    count: number;
	    spaceMB: number;
	
	    static createFrom(source: any = {}) {
	        return new PruneResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.count = source["count"];
	        this.spaceMB = source["spaceMB"];
	    }
	}

}

export namespace nodemodules {
	
	export class Entry {
	    path: string;
	    dir: string;
	    name: string;
	    rel: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.dir = source["dir"];
	        this.name = source["name"];
	        this.rel = source["rel"];
	    }
	}
	export class RemoveResult {
	    path: string;
	    ok: boolean;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoveResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.ok = source["ok"];
	        this.error = source["error"];
	    }
	}
	export class ScanResult {
	    root: string;
	    entries: Entry[];
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root = source["root"];
	        this.entries = this.convertValues(source["entries"], Entry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace ports {
	
	export class PortInfo {
	    port: number;
	    protocol: string;
	    pid: number;
	    processName: string;
	    status: string;
	    parentPid: number;
	    childCount: number;
	
	    static createFrom(source: any = {}) {
	        return new PortInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	        this.pid = source["pid"];
	        this.processName = source["processName"];
	        this.status = source["status"];
	        this.parentPid = source["parentPid"];
	        this.childCount = source["childCount"];
	    }
	}

}

export namespace ssh {
	
	export class ConfigHost {
	    name: string;
	    address: string;
	    port: number;
	    user: string;
	    keyPath: string;
	
	    static createFrom(source: any = {}) {
	        return new ConfigHost(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.keyPath = source["keyPath"];
	    }
	}
	export class ConnectResult {
	    code: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	    }
	}
	export class HostSpec {
	    id: string;
	    address: string;
	    port: number;
	    user: string;
	    method: string;
	    keyPath: string;
	
	    static createFrom(source: any = {}) {
	        return new HostSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.method = source["method"];
	        this.keyPath = source["keyPath"];
	    }
	}
	export class ImportResult {
	    hosts: ConfigHost[];
	    ignored: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hosts = this.convertValues(source["hosts"], ConfigHost);
	        this.ignored = source["ignored"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RemoteContainers {
	    status: string;
	    message: string;
	    items: docker.ContainerInfo[];
	
	    static createFrom(source: any = {}) {
	        return new RemoteContainers(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.items = this.convertValues(source["items"], docker.ContainerInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RemoteImages {
	    status: string;
	    message: string;
	    items: docker.ImageInfo[];
	
	    static createFrom(source: any = {}) {
	        return new RemoteImages(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.items = this.convertValues(source["items"], docker.ImageInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RemotePorts {
	    status: string;
	    message: string;
	    ports: ports.PortInfo[];
	    limited: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RemotePorts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.ports = this.convertValues(source["ports"], ports.PortInfo);
	        this.limited = source["limited"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

