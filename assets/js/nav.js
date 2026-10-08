(() => {
  const nav = document.querySelector('.project-nav');
  const links = [...document.querySelectorAll('.project-nav-links a')];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const updateNav = () => {
    nav?.classList.toggle('scrolled', window.scrollY > 36);

    const marker = window.scrollY + 140;
    let current = sections[0]?.id;
    sections.forEach((section) => {
      if (section.offsetTop <= marker) current = section.id;
    });
    links.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
  };

  updateNav();
  window.addEventListener('scroll', updateNav, { passive: true });
})();
