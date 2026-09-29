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

