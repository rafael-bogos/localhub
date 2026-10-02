import { useEffect, useState } from 'react';
import { RemoteListTunnels } from '../wailsjs/go/main/App';
import { ssh } from '../wailsjs/go/models';
import { EventsOn } from '../wailsjs/runtime/runtime';

/** The open tunnels (local port forwards to containers); kept current by the backend's events. */
export function useTunnels(): ssh.TunnelInfo[] {
    const [tunnels, setTunnels] = useState<ssh.TunnelInfo[]>([]);

    useEffect(() => {
        let cancelled = false;
        // Subscribe before the first read so a change in between isn't lost.
        const off = EventsOn('tunnels:changed', (list: ssh.TunnelInfo[]) => {
            if (!cancelled) setTunnels(Array.isArray(list) ? list : []);
        });
        RemoteListTunnels()
            .then((list) => !cancelled && setTunnels(list ?? []))
            .catch(() => {});
        return () => {
            cancelled = true;
            off();
        };
    }, []);

    return tunnels;
}
