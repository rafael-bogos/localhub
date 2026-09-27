export namespace docker {
	
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
	    }
	}

}

