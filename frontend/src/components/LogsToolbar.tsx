import type { RefObject } from 'react';
import { LEVELS, type Level } from '../logLevel';
import type { LogsPrefs, Period, PrefsPatch, SearchMode } from '../useLogsPrefs';
import { ChevronIcon, CloseIcon, SearchIcon } from './icons';

const PERIODS: { value: Period; label: string }[] = [
    { value: 'all', label: 'Tudo carregado' },
    { value: '5m', label: 'Últimos 5 min' },
    { value: '1h', label: 'Última hora' },
];

const MODES: { value: SearchMode; label: string; title: string }[] = [
    { value: 'filtrar', label: 'Filtrar', title: 'Mostrar só as linhas que casam com a busca' },
    { value: 'destacar', label: 'Destacar', title: 'Mostrar todas as linhas e destacar as ocorrências' },
];

interface LogsToolbarProps {
    prefs: LogsPrefs;
    onChange: (patch: PrefsPatch) => void;
    searchRef: RefObject<HTMLInputElement | null>;
    queryError: boolean;
    visibleCount: number;
    totalCount: number;
    /** Occurrences of the search (only counted in "destacar" mode). */
    matchCount: number;
    matchIndex: number;
    onPrevMatch: () => void;
    onNextMatch: () => void;
    filtering: boolean;
    onClearFilters: () => void;
    frozen: boolean;
    pendingCount: number;
    onToggleFrozen: () => void;
    onClear: () => void;
    onCopy: () => void;
    copied: boolean;
}

function LogsToolbar({
    prefs,
    onChange,
    searchRef,
    queryError,
    visibleCount,
    totalCount,
    matchCount,
    matchIndex,
    onPrevMatch,
    onNextMatch,
    filtering,
    onClearFilters,
    frozen,
    pendingCount,
    onToggleFrozen,
    onClear,
    onCopy,
    copied,
}: LogsToolbarProps) {
    const highlighting = prefs.mode === 'destacar' && prefs.query !== '' && !queryError;

    return (
        <div className="logs-toolbar">
            <div className="logs-toolbar__row">
                <div className={`port-search logs-search${queryError ? ' logs-search--error' : ''}`}>
                    <SearchIcon size={14} className="port-search__icon" />
                    <input
                        ref={searchRef}
                        type="text"
                        className="port-search__input logs-search__input"
                        placeholder="Buscar nos logs"
                        value={prefs.query}
                        spellCheck={false}
                        aria-label="Buscar nos logs"
                        aria-invalid={queryError}
                        onChange={(e) => onChange({ query: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && highlighting) {
                                e.preventDefault();
                                if (e.shiftKey) onPrevMatch();
                                else onNextMatch();
                            }
                        }}
                    />
                    {prefs.query && (
                        <button
                            className="port-search__clear"
                            onClick={() => onChange({ query: '' })}
                            title="Limpar busca"
                            aria-label="Limpar busca"
                        >
                            <CloseIcon size={11} />
                        </button>
                    )}
                </div>

                <button
                    className={`logs-chip logs-chip--mono${prefs.regex ? ' logs-chip--on' : ''}`}
                    aria-pressed={prefs.regex}
                    title={queryError ? 'Expressão regular inválida' : 'Usar expressão regular'}
                    onClick={() => onChange((p) => ({ regex: !p.regex }))}
                >
                    .*
                </button>

                <div className="logs-segment" role="group" aria-label="Modo da busca">
                    {MODES.map((m) => (
                        <button
                            key={m.value}
                            className={`logs-segment__btn${prefs.mode === m.value ? ' logs-segment__btn--on' : ''}`}
                            aria-pressed={prefs.mode === m.value}
                            title={m.title}
                            onClick={() => onChange({ mode: m.value })}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>

                {highlighting && (
                    <div className="logs-nav">
                        <button
                            className="logs-nav__btn"
                            onClick={onPrevMatch}
                            disabled={matchCount === 0}
                            title="Ocorrência anterior (Shift+Enter)"
                            aria-label="Ocorrência anterior"
                        >
                            <ChevronIcon size={12} className="logs-nav__up" />
                        </button>
                        <button
                            className="logs-nav__btn"
                            onClick={onNextMatch}
                            disabled={matchCount === 0}
                            title="Próxima ocorrência (Enter)"
                            aria-label="Próxima ocorrência"
                        >
                            <ChevronIcon size={12} className="logs-nav__down" />
                        </button>
                        <span className="logs-nav__count">
                            {matchCount === 0 ? '0' : `${matchIndex + 1}/${matchCount}`}
                        </span>
                    </div>
                )}
            </div>

            <div className="logs-toolbar__row">
                <div className="logs-group" role="group" aria-label="Origem">
                    {(['stdout', 'stderr'] as const).map((s) => (
                        <button
                            key={s}
                            className={`logs-chip${prefs.sources[s] ? ' logs-chip--on' : ''}`}
                            aria-pressed={prefs.sources[s]}
                            title={`Mostrar ${s}`}
                            onClick={() => onChange((p) => ({ sources: { ...p.sources, [s]: !p.sources[s] } }))}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                <div className="logs-group" role="group" aria-label="Nível">
                    {LEVELS.map((l: Level) => (
                        <button
                            key={l}
                            className={`logs-chip${prefs.levels[l] ? ' logs-chip--on' : ''}`}
                            aria-pressed={prefs.levels[l]}
                            title={l === 'outros' ? 'Linhas sem nível reconhecido' : `Mostrar nível ${l}`}
                            onClick={() => onChange((p) => ({ levels: { ...p.levels, [l]: !p.levels[l] } }))}
                        >
                            {l}
                        </button>
                    ))}
                </div>

                <select
                    className={`logs-select${prefs.period !== 'all' ? ' logs-select--active' : ''}`}
                    value={prefs.period}
                    aria-label="Período"
                    onChange={(e) => onChange({ period: e.target.value as Period })}
                >
                    {PERIODS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="logs-toolbar__row logs-toolbar__row--actions">
                <span className="logs-count" aria-live="polite">
                    {visibleCount === totalCount
                        ? `${totalCount} ${totalCount === 1 ? 'linha' : 'linhas'}`
                        : `${visibleCount} de ${totalCount} linhas`}
                </span>

                {filtering && (
                    <button className="logs-filters-badge" onClick={onClearFilters} title="Voltar a busca e os filtros ao padrão">
                        filtros ativos · limpar
                    </button>
                )}

                <span className="logs-toolbar__spacer" />

                <button
                    className={`logs-chip${prefs.follow ? ' logs-chip--on' : ''}`}
                    aria-pressed={prefs.follow}
                    title="Rolar automaticamente até as linhas novas"
                    onClick={() => onChange((p) => ({ follow: !p.follow }))}
                >
                    Seguir
                </button>
                <button
                    className={`logs-chip${frozen ? ' logs-chip--on' : ''}`}
                    aria-pressed={frozen}
                    title={frozen ? 'Retomar a exibição' : 'Congelar a exibição (o stream continua)'}
                    onClick={onToggleFrozen}
                >
                    {frozen ? `Retomar${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'Pausar'}
                </button>
                <button className="logs-chip" title="Esvaziar a tela (não apaga nada no Docker)" onClick={onClear}>
                    Limpar
                </button>
                <button className="logs-chip" title="Copiar as linhas visíveis" onClick={onCopy}>
                    {copied ? 'Copiado' : 'Copiar'}
                </button>
            </div>
        </div>
    );
}

export default LogsToolbar;
