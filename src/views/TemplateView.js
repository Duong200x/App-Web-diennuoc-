import { getStr, setStr, KEYS } from "../state/storage.js";

// ===== Mặc định mẫu Word (giữ nguyên) =====
const DEFAULT_TPL_WORD = `NGUOI QUAN LI {{APP_NAME}}
PHIEU THU DIEN

{{NGAY_DIEN_DAY}}
Gui nha: {{TEN}}

So dien moi: {{DIEN_MOI}} kWh
So dien cu: {{DIEN_CU}} kWh
Tong dien su dung: {{DIEN_TIEUTHU}} kWh  ×  {{DON_GIA_DIEN_FMT}}  =  {{TIEN_DIEN}} d


PHIEU THU NUOC

{{NGAY_NUOC_DAY}}
So nuoc moi: {{NUOC_MOI}} m3
So nuoc cu: {{NUOC_CU}} m3
Tong nuoc su dung: {{NUOC_TIEUTHU}} m3  ×  {{DON_GIA_NUOC_FMT}}  =  {{TIEN_NUOC}} d


Tong tien dien nuoc:   {{TONG}} d

(Chi nhan tien mat)
Lien he: {{LIEN_HE}}`;

// ===== Mặc định mẫu biên lai 58mm (ESC/POS) =====
// ===== Mặc định mẫu 58mm (có Tạm ứng / Còn thiếu) =====
const DEFAULT_TPL_58 = `@C @B @D {{SHOP_NAME}} @/D @/B
@C {{SHOP_ADDR}}
@C DT: {{SHOP_PHONE}}
@HR
@C @B BIEN LAI THU TIEN @/B
@C {{THANG}}
@HR
Ten: {{TEN}}
Dia chi: {{DIA_CHI}}
Ngay: {{NGAY}}
@HR
Dien cu|{{DIEN_CU}}
Dien moi|{{DIEN_MOI}}
Nuoc cu|{{NUOC_CU}}
Nuoc moi|{{NUOC_MOI}}
So kWh|{{KWH}}
So m3|{{M3}}
@HR
Tien dien|{{TIEN_DIEN}}
Tien nuoc|{{TIEN_NUOC}}
Khoan no|{{KHOAN_NO}}
Tong|{{TONG}}
Tam ung|{{TAM_UNG}}
Con thieu|{{CON_THIEU}}
@HR2
@C Cam on quy khach!
VUI LONG THANH TOAN 
TRONG 1 TUAN QUA HAN
SE BI CAT DIEN NUOC `;

export function mount(el) {
  // dữ liệu hiện có
  const tplWord = getStr(KEYS.tpl, DEFAULT_TPL_WORD);
  const due = getStr(KEYS.due, "");
  const contact = getStr(KEYS.contact, "");

  const tpl58 = getStr(KEYS.tpl58, DEFAULT_TPL_58);
  const shopName  = getStr(KEYS.shop_name,  "");
  const shopAddr  = getStr(KEYS.shop_addr,  "");
  const shopPhone = getStr(KEYS.shop_phone, "");

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <h2>Mẫu phiếu (Word)</h2>
        <textarea id="tplWord" class="input" style="width:100%;min-height:260px;">${tplWord}</textarea>

        <div class="form-grid" style="margin:10px 0;">
          <input id="due" class="input" placeholder="Han thanh toan (tuy chon)" value="${due}"/>
          <input id="contact" class="input" placeholder="Lien he" value="${contact}"/>
        </div>
        <div class="toolbar">
          <button id="saveWord" class="btn">Luu mau Word</button>
        </div>
      </div>

      <div class="spacer"></div>

      <div class="card">
        <h2>Mẫu biên lai in nhiệt (58mm)</h2>
        <div class="form-grid" style="margin:10px 0;">
          <div>
            <label class="label">Ten cua hang/ca nhan</label>
            <input id="shop_name" class="input" placeholder="VD: NHA TRO ABC" value="${shopName}">
          </div>
          <div>
            <label class="label">Dia chi</label>
            <input id="shop_addr" class="input" placeholder="VD: 123 Duong X, Quan Y" value="${shopAddr}">
          </div>
          <div>
            <label class="label">Dien thoai</label>
            <input id="shop_phone" class="input" placeholder="VD: 09xx.xxx.xxx" value="${shopPhone}">
          </div>
        </div>

        <textarea id="tpl58" class="input" rows="16" style="font-family:ui-monospace,Menlo,Consolas,monospace">${tpl58}</textarea>

        <div class="toolbar" style="margin-top:10px">
          <button class="btn" id="save58">Luu mau 58mm</button>
          <button class="btn ghost" id="reset58">Khoi phuc mac dinh</button>
        </div>
      </div>
    </div>
  `;

  // Lưu mẫu Word
  el.querySelector("#saveWord").addEventListener("click", () => {
    setStr(KEYS.tpl, el.querySelector("#tplWord").value);
    setStr(KEYS.due, el.querySelector("#due").value);
    setStr(KEYS.contact, el.querySelector("#contact").value);
    alert("Da luu mau Word.");
  });

  // Lưu thông tin shop (biên lai 58mm)
  ["shop_name","shop_addr","shop_phone"].forEach((k) => {
    const ip = el.querySelector(`#${k}`);
    if (ip) ip.addEventListener("input", () => setStr(KEYS[k], ip.value || ""));
  });

  // Lưu/Reset mẫu 58mm
  el.querySelector("#save58").addEventListener("click", () => {
    setStr(KEYS.tpl58, el.querySelector("#tpl58").value);
    alert("Da luu mau 58mm.");
  });
  el.querySelector("#reset58").addEventListener("click", () => {
    el.querySelector("#tpl58").value = DEFAULT_TPL_58;
    setStr(KEYS.tpl58, DEFAULT_TPL_58);
    alert("Da khoi phuc mau 58mm mac dinh.");
  });
}
