require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { marked } = require("marked");
const { verify } = require("hcaptcha");

// 상수 정의
const POSTS_DIR = path.join(__dirname, "posts");
const PUBLIC_DIR = path.join(__dirname, "public");
const CHAT_DIR = path.join(__dirname, "comments");
const TRASH_DIR = path.join(POSTS_DIR, "trash");
const CHAT_TRASH_DIR = path.join(CHAT_DIR, "trash");
const IMAGES_DIR = path.join(__dirname, "images");

// 필요한 폴더들이 없으면 생성
if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true });
if (!fs.existsSync(CHAT_TRASH_DIR)) fs.mkdirSync(CHAT_TRASH_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.json({ limit: '500mb' }));

// 정적 파일 제공
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/images', express.static(IMAGES_DIR));

// ===== 유틸리티 함수들 =====

// hCaptcha 활성화 여부 확인
function isHcaptchaEnabled() {
    const siteKey = process.env.HCAPTCHA_SITE_KEY;
    const secretKey = process.env.HCAPTCHA_SECRET_KEY;
    
    // 사이트 키나 시크릿 키가 없거나 기본값이거나 빈 값이면 비활성화
    if (!siteKey || !secretKey ||
        siteKey === "YOUR_SITE_KEY_(LEAVE_BLANK_IF_NOT_USED)" ||
        secretKey === "YOUR_SECRET_KEY_(LEAVE_BLANK_IF_NOT_USED)" ||
        siteKey.trim() === "" ||
        secretKey.trim() === "") {
        return false;
    }
    
    return true;
}

// 토큰 검증
function verifyAdminToken(token, password) {
    if (!token || typeof token !== "string") return false;
    const now = Math.floor(Date.now() / 1000);
    for (let offset = -5; offset <= 5; offset++) {
        const compare = now + offset;
        const expected = crypto
            .createHash("sha512")
            .update(password + compare)
            .digest("hex");
        if (expected === token) return true;
    }
    return false;
}

// 댓글 HTML 로드
function loadCommentsHtml(postId) {
    try {
        const chatFile = path.join(CHAT_DIR, `${postId}.json`);
        if (!fs.existsSync(chatFile)) return "<p>No comments yet.</p>";

        const commentsJson = fs.readFileSync(chatFile, "utf-8");
        const comments = JSON.parse(commentsJson);

        // 트리 구조로 변환
        const commentMap = {};
        const roots = [];
        for (const c of comments) {
            c.children = [];
            commentMap[c.id] = c;
        }
        for (const c of comments) {
            if (c.parentId) {
                if (commentMap[c.parentId]) {
                    commentMap[c.parentId].children.push(c);
                } else {
                    roots.push(c); // 부모가 없으면 루트로 처리
                }
            } else {
                roots.push(c);
            }
        }

        function renderTree(list, depth = 0) {
            return list
                .map((c) => {
                    const name = c.name || "Anonymous";
                    const date = c.date || "";
                    const text = c.text || "";
                    return `<li style="margin-bottom:0;margin-left:${
                        depth * 28
                    }px;position:relative;">
                    ${
                        depth > 0
                            ? `<div style='position:absolute;left:-18px;top:0;bottom:0;width:2px;background:rgba(30,144,255,0.13);border-radius:2px;'></div>`
                            : ""
                    }
                    <div id="comment-card-${c.id}" style="padding:0;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px;">
                            <strong style='color:#1e90ff;font-size:1.08em;'>${name}</strong>
                            <small style="color:#aaa;">${date}</small>
                            <button type="button" class="reply-btn" data-reply-name="${name}" data-reply-id="${
                        c.id
                    }">Reply</button>
                        </div>
                        <div style="font-size:1.08em;line-height:1.7;color:#e0e0e0;white-space:pre-line;margin-bottom:2px;">${text}</div>
                    </div>
                    <div style="height:1px;background:rgba(120,120,120,0.18);margin:18px 0 10px 0;"></div>
                    ${
                        c.children && c.children.length
                            ? `<ul style='list-style:none;padding-left:0;margin-top:0;'>${renderTree(
                                  c.children,
                                  depth + 1
                              )}</ul>`
                            : ""
                    }
                </li>`;
                })
                .join("");
        }

        let commentHtml =
            '<section class="comments-section" style="margin-top:40px;"><h3>Comments</h3><ul style="list-style:none;padding-left:0;">';
        commentHtml += renderTree(roots);
        commentHtml += "</ul></section>";
        return commentHtml;
    } catch {
        return "<p>Failed to load comments.</p>";
    }
}

// HTML 템플릿 조립
function wrapWithLayout(htmlFilePath, category = "", overrideId = "") {
    try {
        let head = fs.existsSync(path.join(PUBLIC_DIR, "_head.html"))
            ? fs.readFileSync(path.join(PUBLIC_DIR, "_head.html"), "utf-8")
            : "";
        let foot = fs.existsSync(path.join(PUBLIC_DIR, "_foot.html"))
            ? fs.readFileSync(path.join(PUBLIC_DIR, "_foot.html"), "utf-8")
            : "";
        let body = fs.readFileSync(htmlFilePath, "utf-8");

        const allTags = new Set();
        const files = fs.existsSync(POSTS_DIR)
            ? fs
                  .readdirSync(POSTS_DIR)
                  .filter((f) => /^\d+\.mlmark$/.test(f))
                  .map((f) => parseInt(f))
                  .sort((a, b) => b - a)
                  .map((id) => `${id}.mlmark`)
            : [];

        // HTML 텍스트 변경
        const replacements = {
            "{{ML_BLOG_NAME}}": process.env.ML_BLOG_NAME || "MyLogs",
            "{{ML_USER_NAME}}": process.env.ML_USER_NAME || "User",
            "{{ML_BLOG_URL}}": process.env.ML_BLOG_URL || "https://example.com",
            "{{ML_USER_URL}}": process.env.ML_USER_URL || "https://example.com",
            "{{ML_TRANS_LANG}}": process.env.ML_TRANS_LANG || "en",
            "{{ML_TRANS_ALLCATEGORIES}}":
                process.env.ML_TRANS_ALLCATEGORIES || "All Categories",
            "{{ML_TRANS_CATEGORY}}":
                process.env.ML_TRANS_CATEGORY || "Category",
            "{{ML_TRANS_DATE}}": process.env.ML_TRANS_DATE || "Date",
            "{{ML_TRANS_COMMENT_TITLE}}":
                process.env.ML_TRANS_COMMENT_TITLE || "Comments",
            "{{ML_TRANS_COMMENT_NAME}}":
                process.env.ML_TRANS_COMMENT_NAME || "Nickname",
            "{{ML_TRANS_COMMENT_EMAIL}}":
                process.env.ML_TRANS_COMMENT_EMAIL || "Email (optional)",
            "{{ML_TRANS_COMMENT_TEXT}}":
                process.env.ML_TRANS_COMMENT_TEXT || "Write your comment...",
            "{{ML_TRANS_COMMENT_SUBMIT}}":
                process.env.ML_TRANS_COMMENT_SUBMIT || "Submit",
            "{{ML_TRANS_REPLY_TEXT}}":
                process.env.ML_TRANS_REPLY_TEXT || "Write your reply...",
            "{{ML_TRANS_REPLY_SUBMIT}}":
                process.env.ML_TRANS_REPLY_SUBMIT || "Reply",
            "{{HCAPTCHA_SITE_KEY}}": process.env.HCAPTCHA_SITE_KEY || "",
            "{{HCAPTCHA_ENABLED}}": isHcaptchaEnabled() ? "true" : "false",
            "{{ML_DATA_LIST}}": "",
            "{{ML_DATA_CATEGORY}}": "",
            "{{ML_DATA_COMMENTS}}": "",
        };

        const idMatch = htmlFilePath.match(/(\d+)\.html$/);
        if (overrideId) {
            replacements["{{ML_DATA_ID}}"] = overrideId;
            // 댓글 HTML 치환 추가
            replacements["{{ML_DATA_COMMENTS}}"] = loadCommentsHtml(overrideId);
        } else if (idMatch) {
            replacements["{{ML_DATA_ID}}"] = idMatch[1];
            replacements["{{ML_DATA_COMMENTS}}"] = loadCommentsHtml(idMatch[1]);
        }

        let listHTML = "";
        for (const filename of files) {
            const fullPath = path.join(POSTS_DIR, filename);
            const content = fs.readFileSync(fullPath, "utf-8");
            const metaBlock = content.match(
                /<ml-metadata>([\s\S]*?)<\/ml-metadata>/
            );
            if (!metaBlock) continue;

            const metadata = {};
            const tagMatches = metaBlock[1].matchAll(
                /<ml-(.+?)>(.*?)<\/ml-\1>/g
            );
            for (const match of tagMatches) {
                metadata[match[1]] = match[2];
            }

            if (metadata.tag) allTags.add(metadata.tag);
            if (category && metadata.tag !== category) continue;

            const id = filename.replace(/\.mlmark$/, "");
            if (!replacements["{{ML_DATA_ID}}"]) {
                replacements["{{ML_DATA_ID}}"] = id;
            }

            const title = metadata.title || "(untitled)";
            const tag = metadata.tag || "";
            const cdate = metadata.cdate || "";

            listHTML += `
                <a href="/post/${id}" class="post-card visible" style="display:block;text-decoration:none;color:inherit;">
                    <h3>${title}</h3>
                    <p><strong>${replacements["{{ML_TRANS_CATEGORY}}"]}:</strong> ${tag}</p>
                    <p><strong>${replacements["{{ML_TRANS_DATE}}"]}:</strong> ${cdate}</p>
                </a>
            `;
        }

        const categoryOptions = [
            `<option value="/list">${replacements["{{ML_TRANS_ALLCATEGORIES}}"]}</option>`,
        ];
        for (const tag of [...allTags].sort()) {
            const selected = tag === category ? " selected" : "";
            categoryOptions.push(
                `<option value="/list?category=${encodeURIComponent(
                    tag
                )}"${selected}>${tag}</option>`
            );
        }

        replacements["{{ML_DATA_LIST}}"] = listHTML;
        replacements["{{ML_DATA_CATEGORY}}"] = categoryOptions.join("\n");

        for (const [key, value] of Object.entries(replacements)) {
            // $ 문자가 들어가면 정규식 치환에서 문제가 생길 수 있으므로 이스케이프 처리
            const safeValue = String(value || "").replace(/\$/g, "$$$$");
            head = head.replace(new RegExp(key, "g"), safeValue);
            foot = foot.replace(new RegExp(key, "g"), safeValue);
            body = body.replace(new RegExp(key, "g"), safeValue);
        }

        if (foot && body.includes("</footer>")) {
            body = body.replace("</footer>", `${foot}</footer>`);
        } else {
            body += foot;
        }
        return head + body;
    } catch {
        return null;
    }
}

// 유저 HTML 전송
function sendUserHtml(res, filename, category = "") {
    const fullPath = path.join(PUBLIC_DIR, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).end();
    if (fullPath.endsWith(".html")) {
        const url = new URL("http://dummy" + (res.req?.url || ""));
        const postId = url.searchParams.get("id");
        const content = wrapWithLayout(fullPath, category, postId);
        if (!content) return res.status(500).end();
        res.type("text/html").send(content);
    } else {
        res.sendFile(fullPath);
    }
}

// ===== 라우터 정의 =====

// 홈(목록) 페이지
app.get(["/", "/list"], (req, res) => {
    const category = req.query.category || "";
    sendUserHtml(res, "list.html", category);
});

// 단일 글 보기
app.get("/post/:id", (req, res) => {
    const id = req.params.id;
    if (!id || !/^[\w\-]+$/.test(id)) return res.status(400).end();

    const filePath = path.join(POSTS_DIR, `${id}.mlmark`);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    const raw = fs.readFileSync(filePath, "utf-8");
    const titleMatch = raw.match(/<ml-title>(.*?)<\/ml-title>/);
    const title = titleMatch ? titleMatch[1] : "(untitled)";

    const categoryMatch = raw.match(/<ml-tag>([\s\S]*?)<\/ml-tag>/);
    const category = categoryMatch ? categoryMatch[1] : "";
    const categoryHTML = category
        ? `<div style="font-size: 18px; color: #aaa; margin-top: -8px; margin-bottom: 12px;">${category}</div>`
        : "";
    const bodyStart = raw.indexOf("</ml-metadata>");
    const body =
        bodyStart >= 0
            ? (() => {
                marked.use({
                    tokenizer: {
                        lheading() {} // Setext-style header 비활성화
                    }
                });
                return marked(raw.slice(bodyStart + 15).trim(), {
                    breaks: true, // 줄바꿈을 <br>로 변환
                    gfm: true, // GitHub Flavored Markdown 지원
                });
            })()
            : "";

    let html = wrapWithLayout(path.join(PUBLIC_DIR, "post.html"), "", id);
    if (html) {
        html = html
            .replace(/{{ML_DATA_TITLE}}/g, title)
            .replace(/{{ML_DATA_CATEGORY_DISPLAY}}/g, categoryHTML)
            .replace(/{{ML_DATA_BODY}}/g, body);

        res.type("text/html").send(html);
    } else {
        res.status(500).end();
    }
});

// 기존 쿼리 형식 URL을 새로운 형식으로 리다이렉트
app.get("/post", (req, res) => {
    const id = req.query.id;
    if (!id || !/^[\w\-]+$/.test(id)) return res.status(400).end();
    
    // 새로운 URL 형식으로 리다이렉트
    res.redirect(301, `/post/${id}`);
});

// 이미지 업로드 API
app.post("/api/admin/image/upload", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD"))
        return res.status(401).json({ error: "Unauthorized" });

    const { image, filename } = req.body;
    if (!image || !filename) {
        return res.status(400).json({ error: "Image and filename are required" });
    }

    try {
        // Base64 데이터에서 실제 이미지 데이터 추출
        const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        
        // 파일 크기 체크 (500MB 제한)
        if (buffer.length > 500 * 1024 * 1024) {
            return res.status(400).json({ error: "File size too large (max 500MB)" });
        }
        
        // 파일 확장자 확인
        const ext = path.extname(filename).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            return res.status(400).json({ error: "Unsupported file type" });
        }
        
        // 고유한 파일명 생성 (타임스탬프 + 랜덤)
        const uniqueFilename = Date.now() + '_' + Math.random().toString(36).substr(2, 9) + ext;
        const filePath = path.join(IMAGES_DIR, uniqueFilename);
        
        // 파일 저장
        fs.writeFileSync(filePath, buffer);
        
        // 성공 응답
        res.json({
            success: true,
            filename: uniqueFilename,
            url: `/images/${uniqueFilename}`
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ error: "Failed to upload image" });
    }
});

// 댓글 작성 API
app.post("/api/user/chat/new", async (req, res) => {
    // 파라미터 추출
    const { postId, name, email, text, date, parentId, hcaptchaToken } = req.body;
    if (!postId || !name || !text || !date) {
        return res.status(400).json({ error: "Required fields are missing." });
    }

    // hCaptcha 검증 (활성화된 경우에만)
    if (isHcaptchaEnabled()) {
        if (!hcaptchaToken) {
            return res.status(400).json({ error: "hCaptcha verification is required." });
        }

        try {
            const hcaptchaResponse = await verify(process.env.HCAPTCHA_SECRET_KEY, hcaptchaToken);
            if (!hcaptchaResponse.success) {
                return res.status(400).json({ error: "hCaptcha verification failed." });
            }
        } catch (error) {
            console.error('hCaptcha verification error:', error);
            return res.status(500).json({ error: "hCaptcha verification error." });
        }
    }

    // 댓글 저장 경로
    const chatFile = path.join(CHAT_DIR, `${postId}.json`);

    // chat 폴더가 없으면 생성
    if (!fs.existsSync(CHAT_DIR)) {
        fs.mkdirSync(CHAT_DIR);
    }

    // 기존 댓글 불러오기
    let comments = [];
    if (fs.existsSync(chatFile)) {
        try {
            comments = JSON.parse(fs.readFileSync(chatFile, "utf-8"));
        } catch (e) {
            comments = [];
        }
    }

    // 고유 ID 생성 (타임스탬프+랜덤)
    const id =
        Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    // 새 댓글 객체
    const newComment = {
        id,
        parentId: parentId || null,
        name,
        email: email || "",
        text,
        date,
    };

    comments.push(newComment);
    fs.writeFileSync(chatFile, JSON.stringify(comments, null, 2), "utf-8");

    return res.json({ success: true, comment: newComment });
});

// 메인 페이지
app.get("/admin", (req, res) => {
    sendUserHtml(res, "admin/index.html");
});

// 관리자 글 목록
app.get("/admin/post", (req, res) => {
    sendUserHtml(res, "admin/post/list.html");
});

app.get("/admin/comment/list", (req, res) => {
    sendUserHtml(res, "admin/comment/list.html");
});

// 글 수정 페이지
app.get("/admin/post/edit", (req, res) => {
    sendUserHtml(res, "admin/post/edit.html");
});

app.get("/admin/comment/edit", (req, res) => {
    sendUserHtml(res, "admin/comment/edit.html");
});

// 새 글 작성 페이지
app.get("/admin/post/new", (req, res) => {
    sendUserHtml(res, "admin/post/new.html");
});

// ===== API 라우트들 =====

// 글 목록 조회
app.get("/api/user/post/list/:limit", (req, res) => {
    const limit = parseInt(req.params.limit);
    if (isNaN(limit)) return res.status(400).end();

    const files = fs
        .readdirSync(POSTS_DIR)
        .filter((f) => /^\d+\.mlmark$/.test(f))
        .map((f) => parseInt(f))
        .sort((a, b) => b - a)
        .slice(0, limit);

    const results = [];

    for (const id of files) {
        const file = path.join(POSTS_DIR, `${id}.mlmark`);
        if (!fs.existsSync(file)) continue;

        const content = fs.readFileSync(file, "utf-8");
        const metaBlock = content.match(
            /<ml-metadata>([\s\S]*?)<\/ml-metadata>/
        );
        if (!metaBlock) continue;

        const metadata = {};
        const tagMatches = metaBlock[1].matchAll(/<ml-(.+?)>(.*?)<\/ml-\1>/g);
        for (const match of tagMatches) {
            metadata[match[1]] = match[2];
        }

        results.push({
            slug: id,
            title: metadata.title || "",
            tag: metadata.tag || "",
            cdate: metadata.cdate || "",
        });
    }

    res.json(results);
});

// 단일 글 조회
app.get("/api/user/post/get", (req, res) => {
    const id = req.query.id;
    if (!id || !/^\d+$/.test(id)) return res.status(400).end();

    const file = path.join(POSTS_DIR, `${id}.mlmark`);
    if (!fs.existsSync(file)) return res.status(404).end();

    const raw = fs.readFileSync(file, "utf-8");
    res.type("text/plain").send(raw);
});

// 새 글 작성
app.post("/api/admin/post/new", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD"))
        return res.status(401).end();

    const title = req.body.title?.trim();
    const tag = req.body.tag?.trim();
    const body = req.body.body?.trim();
    if (!title || !tag || !body) return res.status(400).end();

    const files = fs
        .readdirSync(POSTS_DIR)
        .filter((f) => /^\d+\.mlmark$/.test(f))
        .map((f) => parseInt(f));
    const id = files.length ? Math.max(...files) + 1 : 1;

    const now = new Date().toISOString().slice(0, 10);

    const content = `<ml-metadata>
<ml-title>${title}</ml-title>
<ml-tag>${tag}</ml-tag>
<ml-cdate>${now}</ml-cdate>
<ml-edate>${now}</ml-edate>
</ml-metadata>\n\n${body}`;

    fs.writeFileSync(path.join(POSTS_DIR, `${id}.mlmark`), content, "utf-8");
    res.json({ id });
});

// 글 수정
app.post("/api/admin/post/edit/:id", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD"))
        return res.status(401).end();

    const id = req.params.id;
    const title = req.body.title?.trim();
    const tag = req.body.tag?.trim();
    const body = req.body.body?.trim();
    if (!/^\d+$/.test(id) || !title || !tag || !body)
        return res.status(400).end();

    const file = path.join(POSTS_DIR, `${id}.mlmark`);
    if (!fs.existsSync(file)) return res.status(404).end();

    const raw = fs.readFileSync(file, "utf-8");
    const cdate =
        (raw.match(/<ml-cdate>(.*?)<\/ml-cdate>/) || [])[1] ||
        new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().slice(0, 10);

    const content = `<ml-metadata>
<ml-title>${title}</ml-title>
<ml-tag>${tag}</ml-tag>
<ml-cdate>${cdate}</ml-cdate>
<ml-edate>${now}</ml-edate>
</ml-metadata>\n\n${body}`;

    fs.writeFileSync(file, content, "utf-8");
    res.json({ ok: true });
});

// 글 삭제
app.post("/api/admin/post/delete/:id", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD"))
        return res.status(401).end();

    const id = req.params.id;
    if (!/^\d+$/.test(id)) return res.status(400).end();

    const file = path.join(POSTS_DIR, `${id}.mlmark`);
    if (!fs.existsSync(file)) return res.status(404).end();

    const trashedPath = path.join(TRASH_DIR, `${id}.mlmark`);
    fs.renameSync(file, trashedPath);

    // 댓글 파일도 휴지통으로 이동
    const chatFile = path.join(CHAT_DIR, `${id}.json`);
    if (fs.existsSync(chatFile)) {
        const trashedChatPath = path.join(CHAT_TRASH_DIR, `${id}.json`);
        fs.renameSync(chatFile, trashedChatPath);
    }
    res.json({ ok: true });
});

// ===== Comment Admin APIs =====

// 댓글 목록 조회
app.post("/api/admin/comment/list", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD")) {
        return res.status(401).end();
    }

    const allComments = [];
    const chatFiles = fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json'));

    for (const file of chatFiles) {
        const postId = file.replace('.json', '');
        const postFilePath = path.join(POSTS_DIR, `${postId}.mlmark`);
        let postTitle = 'Unknown Post';
        try {
            if (fs.existsSync(postFilePath)) {
                const postContent = fs.readFileSync(postFilePath, 'utf-8');
                const titleMatch = postContent.match(/<ml-title>(.*?)<\/ml-title>/);
                if (titleMatch && titleMatch[1]) {
                    postTitle = titleMatch[1];
                }
            }
        } catch (e) {
            // 게시글 파일을 읽지 못해도 오류 무시
        }

        const chatFile = path.join(CHAT_DIR, file);
        try {
            const comments = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
            for (const comment of comments) {
                allComments.push({
                    id: comment.id,
                    postId: postId,
                    postTitle: postTitle,
                    author: comment.name,
                    content: comment.text,
                    cdate: comment.date
                });
            }
        } catch (e) {
            // 댓글 파일 파싱 오류 무시
        }
    }
    res.json(allComments.sort((a,b) => parseInt(b.cdate.replace(/\D/g,'')) - parseInt(a.cdate.replace(/\D/g,''))));
});

// 단일 댓글 조회
app.post("/api/admin/comment/get", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD")) {
        return res.status(401).end();
    }
    const id = req.query.id;
    if (!id) return res.status(400).end();

    const files = fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const chatFile = path.join(CHAT_DIR, file);
        try {
            const comments = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
            const found = comments.find(c => c.id === id);
            if (found) {
                return res.json({
                    id: found.id,
                    content: found.text,
                    author: found.name,
                    cdate: found.date,
                    postId: file.replace('.json', '')
                });
            }
        } catch (e) {
            // Ignore
        }
    }

    res.status(404).json({ error: 'Comment not found' });
});

// 댓글 수정
app.post("/api/admin/comment/edit/:id", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD")) {
        return res.status(401).end();
    }
    const id = req.params.id;
    const { content } = req.body;
    if (!id || !content) return res.status(400).end();

    const files = fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const chatFile = path.join(CHAT_DIR, file);
        try {
            let comments = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
            const commentIndex = comments.findIndex(c => c.id === id);
            if (commentIndex !== -1) {
                comments[commentIndex].text = content;
                fs.writeFileSync(chatFile, JSON.stringify(comments, null, 2), 'utf-8');
                return res.json({ ok: true });
            }
        } catch (e) {
            //
        }
    }
    res.status(404).json({ error: 'Comment not found' });
});

// 댓글 삭제
app.post("/api/admin/comment/delete/:id", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD")) {
        return res.status(401).end();
    }
    const id = req.params.id;
    if (!id) return res.status(400).end();

    const files = fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const chatFile = path.join(CHAT_DIR, file);
        try {
            let comments = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
            const initialLength = comments.length;
            comments = comments.filter(c => c.id !== id);
            if (comments.length < initialLength) {
                fs.writeFileSync(chatFile, JSON.stringify(comments, null, 2), 'utf-8');
                return res.json({ ok: true });
            }
        } catch (e) {
            //
        }
    }
    res.status(404).json({ error: 'Comment not found' });
});

// 최근 댓글 조회 (관리자용)
app.post("/api/admin/comment/recent", (req, res) => {
    const token = req.body.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD")) {
        return res.status(401).end();
    }

    const allComments = [];
    const chatFiles = fs.readdirSync(CHAT_DIR).filter(f => f.endsWith('.json'));

    for (const file of chatFiles) {
        const postId = file.replace('.json', '');
        const postFilePath = path.join(POSTS_DIR, `${postId}.mlmark`);
        let postTitle = 'Unknown Post';
        try {
            if (fs.existsSync(postFilePath)) {
                const postContent = fs.readFileSync(postFilePath, 'utf-8');
                const titleMatch = postContent.match(/<ml-title>(.*?)<\/ml-title>/);
                if (titleMatch && titleMatch[1]) {
                    postTitle = titleMatch[1];
                }
            }
        } catch (e) { /* 무시 */ }

        const chatFile = path.join(CHAT_DIR, file);
        try {
            const comments = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
            for (const comment of comments) {
                allComments.push({
                    id: comment.id,
                    postId: postId,
                    postTitle: postTitle,
                    author: comment.name,
                    content: comment.text,
                    cdate: comment.date
                });
            }
        } catch (e) { /* 무시 */ }
    }
    
    const recentComments = allComments
        .sort((a, b) => new Date(b.cdate) - new Date(a.cdate))
        .slice(0, 10);
    
    res.json(recentComments);
});

// 토큰 확인
app.post("/api/admin/verify", (req, res) => {
    const token = req.body?.token;
    if (!verifyAdminToken(token, process.env.ADMIN_PASSWORD || "PASSWORD"))
        return res.status(401).end();
    res.json({ ok: true });
});

// 사이트 정보
app.get("/api/site/meta", (req, res) => {
    res.json({ title: process.env.ML_BLOG_NAME || "MyLogs" });
});

// fallback HTML 처리
app.use((req, res, next) => {
    const fullPath = path.join(PUBLIC_DIR, req.path.replace(/^\/+/, ""));
    if (fs.existsSync(fullPath) && fullPath.endsWith(".html")) {
        const content = wrapWithLayout(fullPath);
        if (!content) return res.status(500).end();
        return res.type("text/html").send(content);
    }
    next();
});

// 서버 실행
const PORT = 3000;
app.listen(PORT, () => {
    console.log();
    console.log(`==== MyLogs v0.2 ====`);
    console.log(`View more on https://github.com/jaeone22/MyLogs`);
    console.log(`Server running at http://localhost:${PORT}`);
});
