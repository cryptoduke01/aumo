// The vault mark rendered as ASCII (generated from the brand art with an
// ordered luminance ramp). A quiet, on-brand texture for content headers.
const ART = `       =================================================-
       @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#
       %%%%#****************************************#%%%#
       %@%@-                                        +@%@#
       %@%@-                                        +@%@#
       %@%@-                                        +@%@#
       %@%@-            ::::::::::::::::            +@%@#
       %@%@-           :@@@@@@@@@@@@@@@@:           +@%@#
       %@%@-           :%%%%%%%%%%%%%%%%:           +@%@#
       %@%@-           :@%@@@@@@@@@@@@%@:           +@%@#
       %@%@-           :@%@@@@@@@@@@@@%%:           +@%@#
       %@%@-           :%%%%%%%%%%%%%%@@:           +@%@#
       %@%@-           :@@@@@@@@@@@@@@%=            +@%@#
       %@%@-           :%%%%%%%%%%%%#=              +@%@#
       %@%@-                                        +@%%#
       %@%@-                                       -%%%@#
       %@%@-                                     -#@@@@*:
       %@%@-                                   -#@@@@*:
       %@%@-                                 -#@@@@*:
       %%%%################################@@@@*:
       @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@*:
       -------------------------------------:`;

export function AsciiMark({ className = "" }: { className?: string }) {
  return (
    <pre
      aria-hidden="true"
      className={`select-none overflow-hidden font-mono leading-[1.05] text-accent/70 ${className}`}
      style={{ fontSize: "0.4rem" }}
    >
      {ART}
    </pre>
  );
}
