const loginForm = document.getElementById('admin-login-form');
const loginMessage = document.getElementById('admin-login-message');

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);
  submitButton.disabled = true;
  loginMessage.textContent = 'Verificando acceso…';
  loginMessage.classList.remove('is-error');

  try {
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'No se pudo iniciar sesión.');
    window.location.assign('/admin');
  } catch (error) {
    loginMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
    loginMessage.classList.add('is-error');
    submitButton.disabled = false;
  }
});
