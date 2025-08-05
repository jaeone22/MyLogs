let adminPassword = '';
let adminToken = '';

async function sha512(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-512', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyToken(token) {
    const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            token
        })
    });
    return res.ok;
}

async function initializeAdminPage(onAuthSuccess) {
    adminPassword = localStorage.getItem('adminPassword');

    if (adminPassword) {
        const now = Math.floor(Date.now() / 1000);
        const tokenToVerify = await sha512(adminPassword + (now - 1));
        const ok = await verifyToken(tokenToVerify);
        if (ok) {
            adminToken = await sha512(adminPassword + now); 
            if (onAuthSuccess) onAuthSuccess();
            return;
        }
    }

    localStorage.removeItem('adminPassword');
    adminPassword = prompt("🔐 MyLogs Admin Password");
    if (!adminPassword) {
        alert("❌ Authenticate Failure");
        location.href = '/';
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenToVerify = await sha512(adminPassword + (now - 1));
    const ok = await verifyToken(tokenToVerify);

    if (!ok) {
        alert("❌ Authenticate Failure");
        location.href = '/';
        return;
    }
    
    // 인증 성공 시 API 호출에 사용할 토큰 설정 및 비밀번호 저장
    adminToken = await sha512(adminPassword + now);
    localStorage.setItem('adminPassword', adminPassword);
    if (onAuthSuccess) onAuthSuccess();
}