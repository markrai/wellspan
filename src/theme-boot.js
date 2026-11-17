try {
  var wellspanTheme = localStorage.getItem('wellspan-theme');
  if (wellspanTheme !== 'dark' && wellspanTheme !== 'light') {
    wellspanTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = wellspanTheme;
} catch (error) { document.documentElement.dataset.theme = 'light'; }
