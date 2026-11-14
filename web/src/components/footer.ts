import "../styles/footer.css";

type Column = {
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
};

const COLUMNS: Column[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Features", href: "/#features" },
      { label: "Web client", href: "/app" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "GitHub", href: "https://github.com/mealisohail/peershell", external: true },
      { label: "Documentation", href: "https://github.com/mealisohail/peershell#readme", external: true },
      { label: "Protocol spec", href: "https://github.com/mealisohail/peershell/tree/main/docs", external: true },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "About", href: "/#use-cases" },
      { label: "License (MIT)", href: "https://github.com/mealisohail/peershell", external: true },
      { label: "Changelog", href: "https://github.com/mealisohail/peershell/commits/main", external: true },
    ],
  },
];

export function mountFooter(host: HTMLElement): void {
  const columnsHtml = COLUMNS.map(
    (col) => `
      <div class="footer__col">
        <h4 class="footer__col-head">${col.heading}</h4>
        <ul class="footer__col-list">
          ${col.links
            .map(
              (l) =>
                `<li><a href="${l.href}"${l.external ? ' rel="noopener"' : ""}>${l.label}</a></li>`,
            )
            .join("")}
        </ul>
      </div>
    `,
  ).join("");

  host.innerHTML = `
    <footer class="section section--footer">
      <div class="container footer__grid">
        <div class="footer__brand">
          <a class="footer__wordmark" href="/">peershell</a>
          <p class="footer__tagline">A terminal, shared peer-to-peer.</p>
        </div>
        <div class="footer__cols">${columnsHtml}</div>
      </div>
      <div class="container footer__bottom">
        <span>Made for developers who'd rather not tunnel.</span>
      </div>
    </footer>
  `;
}
