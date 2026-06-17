document.addEventListener('DOMContentLoaded', () => {

  document.querySelectorAll('.fig-slider-wrap').forEach(wrap => {
    const afterWrap = wrap.querySelector('.fig-slider-after-wrap');
    const handle = wrap.querySelector('.fig-slider-handle');
    let dragging = false;

    function updateDimensions() {
      const rect = wrap.getBoundingClientRect();
      wrap.style.setProperty('--slider-width', `${rect.width}px`);
    }

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    function setPosition(clientX) {
      const rect = wrap.getBoundingClientRect();
      const pct = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);

      afterWrap.style.width = (pct * 100) + '%';
      handle.style.left = (pct * 100) + '%';
      handle.setAttribute('aria-valuenow', Math.round(pct * 100));
    }

    // Mouse Events on the ENTIRE wrapper
    wrap.addEventListener('mousedown', e => {
      dragging = true;
      setPosition(e.clientX); // Move immediately to click position
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (dragging) setPosition(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    // Touch Events on the ENTIRE wrapper
    wrap.addEventListener('touchstart', e => {
      dragging = true;
      setPosition(e.touches[0].clientX); // Move immediately to touch position
    }, { passive: true });

    window.addEventListener('touchmove', e => {
      if (dragging) setPosition(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      dragging = false;
    });

    // Keyboard events (Keep focused on the handle wrapper for accessibility)
    handle.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      const rect = wrap.getBoundingClientRect();
      const step = e.shiftKey ? 10 : 2;
      const cur = parseFloat(handle.style.left || '50');

      let nextPct = e.key === 'ArrowLeft' ? cur - step : cur + step;
      nextPct = Math.min(Math.max(nextPct, 0), 100);

      const targetX = rect.left + (rect.width * (nextPct / 100));
      setPosition(targetX);
      e.preventDefault();
    });
  });

  // Copy buttons
  document.querySelectorAll('.highlight').forEach(block => {
    const wrapper = document.createElement('div')
    wrapper.className = 'highlight-wrapper'
    block.parentNode.insertBefore(wrapper, block)
    wrapper.appendChild(block)

    const button = document.createElement('button')
    button.className = 'copy-btn'
    button.textContent = 'Copy'
    wrapper.appendChild(button)

    button.addEventListener('click', () => {
      const code = block.querySelector('code').innerText
      navigator.clipboard.writeText(code).then(() => {
        button.textContent = 'Copied!'
        setTimeout(() => button.textContent = 'Copy', 2000)
      })
    })
  })

  // Nav toggle
  const toggle = document.querySelector('.nav-toggle')
  const nav = document.querySelector('.site-nav')

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open')
      toggle.setAttribute('aria-expanded', open)
    })
  }

})
