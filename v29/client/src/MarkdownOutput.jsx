import ReactMarkdown from "react-markdown";

const components = {
  h1: (props) => (
    <h1
      style={{
        fontSize: 28,
        color: "#f0ece4",
        fontWeight: 500,
        lineHeight: 1.3,
        margin: "0 0 16px",
      }}
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      style={{
        fontSize: 19,
        color: "#f0ece4",
        fontWeight: 600,
        lineHeight: 1.35,
        margin: "28px 0 12px",
      }}
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      style={{
        fontSize: 15,
        color: "#e7decb",
        fontWeight: 600,
        lineHeight: 1.4,
        margin: "22px 0 10px",
      }}
      {...props}
    />
  ),
  p: (props) => (
    <p
      style={{
        margin: "0 0 14px",
        color: "#c8c0b0",
        fontSize: 14,
        lineHeight: 1.8,
      }}
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      style={{
        margin: "0 0 16px",
        paddingInlineStart: 22,
        color: "#c8c0b0",
        fontSize: 14,
        lineHeight: 1.8,
      }}
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      style={{
        margin: "0 0 16px",
        paddingInlineStart: 22,
        color: "#c8c0b0",
        fontSize: 14,
        lineHeight: 1.8,
      }}
      {...props}
    />
  ),
  li: (props) => <li style={{ marginBottom: 6 }} {...props} />,
  strong: (props) => (
    <strong style={{ color: "#f0ece4", fontWeight: 600 }} {...props} />
  ),
  em: (props) => (
    <em style={{ color: "#d4c4a0" }} {...props} />
  ),
  hr: (props) => (
    <hr
      style={{
        border: 0,
        borderTop: "1px solid #2a2a2a",
        margin: "20px 0",
      }}
      {...props}
    />
  ),
  code: ({ inline, children, ...props }) => {
    if (inline) {
      return (
        <code
          style={{
            background: "#181818",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            padding: "0.15em 0.35em",
            color: "#efe6d4",
            fontSize: "0.92em",
          }}
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <code
        style={{
          display: "block",
          whiteSpace: "pre-wrap",
          background: "#0e0e0e",
          border: "1px solid #2a2a2a",
          borderRadius: 6,
          padding: "16px 18px",
          color: "#efe6d4",
          fontSize: 13,
          lineHeight: 1.8,
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  blockquote: (props) => (
    <blockquote
      style={{
        margin: "0 0 16px",
        padding: "0 0 0 14px",
        borderLeft: "3px solid #3a342a",
        color: "#c8c0b0",
      }}
      {...props}
    />
  ),
};

export default function MarkdownOutput({ content, dir = "ltr", style = {} }) {
  return (
    <div
      dir={dir}
      style={{
        background: "#0e0e0e",
        border: "1px solid #2a2a2a",
        borderRadius: 6,
        padding: "20px 24px",
        textAlign: dir === "rtl" ? "right" : "left",
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      <ReactMarkdown components={components}>{content || ""}</ReactMarkdown>
    </div>
  );
}