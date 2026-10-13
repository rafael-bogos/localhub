interface RowCheckProps {
    checked: boolean;
    onChange: () => void;
    label: string;
    disabled?: boolean;
    /** Some, but not all, rows are selected (the header checkbox). */
    indeterminate?: boolean;
}

/** The selection checkbox of a table row; never triggers the row's own click. */
function RowCheck({ checked, onChange, label, disabled, indeterminate }: RowCheckProps) {
    return (
        <input
            type="checkbox"
            className="row-check"
            checked={checked}
            disabled={disabled}
            aria-label={label}
            title={label}
            ref={(el) => {
                if (el) el.indeterminate = !!indeterminate && !checked;
            }}
            onChange={onChange}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        />
    );
}

export default RowCheck;
