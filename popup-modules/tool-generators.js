(function () {
  'use strict';

  const NAME_DATA = {
    en: {
      male: ['James', 'John', 'Robert', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank', 'Alexander', 'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Nathan', 'Henry', 'Peter', 'Adam', 'Douglas', 'Zachary', 'Logan', 'Ethan', 'Noah', 'Mason', 'Lucas', 'Oliver', 'Elijah', 'Liam', 'Aiden', 'Carter', 'Luke', 'Owen', 'Dylan', 'Hunter', 'Gabriel', 'Caleb', 'Connor'],
      female: ['Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Dorothy', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Kathleen', 'Amy', 'Angela', 'Shirley', 'Anna', 'Brenda', 'Pamela', 'Emma', 'Nicole', 'Helen', 'Samantha', 'Katherine', 'Christine', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Catherine', 'Maria', 'Heather', 'Diane', 'Ruth', 'Julie', 'Olivia', 'Joyce', 'Virginia', 'Victoria', 'Kelly', 'Lauren', 'Christina', 'Joan', 'Evelyn', 'Judith', 'Megan', 'Andrea', 'Cheryl', 'Hannah', 'Jacqueline', 'Martha', 'Gloria', 'Teresa', 'Ann', 'Sara', 'Madison', 'Frances', 'Kathryn', 'Janice', 'Jean', 'Abigail', 'Alice', 'Judy', 'Sophia', 'Grace', 'Denise', 'Amber', 'Doris', 'Marilyn', 'Danielle', 'Beverly', 'Isabella', 'Theresa', 'Diana', 'Natalie', 'Brittany', 'Charlotte', 'Marie', 'Kayla', 'Alexis', 'Lori'],
      last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Evans', 'Turner', 'Phillips', 'Parker', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Peterson', 'Cooper', 'Reed', 'Bailey', 'Bell', 'Gomez', 'Kelly', 'Howard', 'Ward', 'Cox', 'Diaz', 'Richardson', 'Wood', 'Watson', 'Brooks', 'Bennett', 'Gray', 'James', 'Reyes', 'Cruz', 'Hughes', 'Price', 'Myers', 'Long', 'Foster', 'Sanders', 'Ross', 'Morales', 'Powell', 'Sullivan', 'Russell', 'Ortiz', 'Jenkins']
    },
    zh: {
      surname: ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕', '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎', '余', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜', '范', '方', '石', '姚', '谭', '廖', '邹', '熊', '金', '陆', '郝', '孔', '白', '崔', '康', '毛', '邱', '秦', '江', '史', '顾', '侯', '邵', '孟', '龙', '万', '段', '章', '钱', '汤', '尹', '黎', '易', '常', '武', '乔', '贺', '赖', '龚', '文'],
      male: ['伟', '强', '磊', '洋', '勇', '军', '杰', '涛', '超', '明', '刚', '平', '辉', '鑫', '鹏', '飞', '波', '斌', '宇', '浩', '然', '俊', '哲', '睿', '博', '昊', '翔', '旭', '栋', '晖', '健', '凯', '锐', '彬', '毅', '轩', '恒', '骏', '松', '宁', '铭', '瑞', '驰', '瀚', '翰', '霖', '华', '文', '志', '熙', '泽', '航', '皓', '嘉', '禹', '煜', '逸', '清', '楠', '峰'],
      female: ['芳', '娜', '敏', '静', '丽', '莉', '秀', '玲', '桂', '燕', '萍', '华', '红', '玉', '慧', '琳', '雪', '婷', '珍', '颖', '欣', '怡', '蕾', '雯', '洁', '瑶', '璐', '薇', '妍', '馨', '彤', '晗', '梦', '琪', '岚', '蓓', '苑', '茜', '蕊', '妮', '菲', '晴', '诗', '涵', '媛', '悦', '佳', '瑾', '若', '萱', '彦', '姝', '韵', '寒', '曦', '依', '舒', '宜', '凝', '柔']
    }
  };

  const ADDRESS_DATA = {
    zh: {
      provinces: [
        { name: '北京市', cities: ['东城区', '西城区', '朝阳区', '丰台区', '石景山区', '海淀区', '顺义区', '通州区', '大兴区', '昌平区'] },
        { name: '上海市', cities: ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '浦东新区', '闵行区', '宝山区'] },
        { name: '广东省', cities: ['广州市', '深圳市', '珠海市', '东莞市', '佛山市', '中山市', '惠州市', '汕头市', '江门市', '湛江市'] },
        { name: '浙江省', cities: ['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '台州市'] },
        { name: '江苏省', cities: ['南京市', '苏州市', '无锡市', '常州市', '南通市', '扬州市', '镇江市', '徐州市'] },
        { name: '四川省', cities: ['成都市', '绵阳市', '德阳市', '宜宾市', '南充市', '泸州市', '乐山市'] },
        { name: '湖北省', cities: ['武汉市', '宜昌市', '襄阳市', '荆州市', '黄冈市', '十堰市'] },
        { name: '湖南省', cities: ['长沙市', '株洲市', '湘潭市', '衡阳市', '岳阳市', '常德市'] },
        { name: '山东省', cities: ['济南市', '青岛市', '烟台市', '潍坊市', '临沂市', '淄博市'] },
        { name: '福建省', cities: ['福州市', '厦门市', '泉州市', '漳州市', '龙岩市', '莆田市'] },
        { name: '河南省', cities: ['郑州市', '洛阳市', '开封市', '南阳市', '新乡市', '安阳市'] },
        { name: '安徽省', cities: ['合肥市', '芜湖市', '安庆市', '马鞍山市', '蚌埠市'] },
        { name: '河北省', cities: ['石家庄市', '唐山市', '保定市', '邯郸市', '廊坊市'] },
        { name: '辽宁省', cities: ['沈阳市', '大连市', '鞍山市', '抚顺市', '锦州市'] },
        { name: '陕西省', cities: ['西安市', '咸阳市', '宝鸡市', '渭南市', '延安市'] },
        { name: '重庆市', cities: ['渝中区', '江北区', '沙坪坝区', '九龙坡区', '南岸区', '渝北区', '巴南区'] },
        { name: '天津市', cities: ['和平区', '河西区', '南开区', '河东区', '河北区', '滨海新区'] },
        { name: '云南省', cities: ['昆明市', '大理市', '丽江市', '曲靖市'] },
        { name: '贵州省', cities: ['贵阳市', '遵义市', '六盘水市'] },
        { name: '广西', cities: ['南宁市', '桂林市', '柳州市', '北海市'] }
      ],
      roads: ['中山路', '解放路', '人民路', '建设路', '文化路', '和平路', '新华路', '长安街', '南京路', '北京路',
        '朝阳路', '花园路', '科技路', '创业路', '滨海路', '学府路', '迎宾路', '幸福路', '光明路', '长江路',
        '黄河路', '泰山路', '华山路', '庐山路', '天山路', '昆仑路', '长江街', '复兴路', '建国路', '锦绣路'],
      suffixes: ['小区', '花园', '公寓', '新村', '大厦', '广场', '中心'],
      buildingPrefixes: ['A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '5', '6', '7', '8']
    },
    en: {
      states: [
        { name: 'CA', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland', 'Palo Alto'] },
        { name: 'NY', cities: ['New York', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Yonkers'] },
        { name: 'TX', cities: ['Houston', 'Austin', 'Dallas', 'San Antonio', 'Fort Worth', 'Plano', 'Irving'] },
        { name: 'FL', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Tallahassee'] },
        { name: 'IL', cities: ['Chicago', 'Springfield', 'Naperville', 'Peoria', 'Rockford'] },
        { name: 'WA', cities: ['Seattle', 'Bellevue', 'Redmond', 'Tacoma', 'Spokane', 'Vancouver'] },
        { name: 'MA', cities: ['Boston', 'Cambridge', 'Worcester', 'Springfield', 'Lowell'] },
        { name: 'CO', cities: ['Denver', 'Boulder', 'Colorado Springs', 'Aurora', 'Fort Collins'] },
        { name: 'OR', cities: ['Portland', 'Eugene', 'Salem', 'Bend', 'Hillsboro'] },
        { name: 'GA', cities: ['Atlanta', 'Savannah', 'Augusta', 'Athens', 'Macon'] }
      ],
      streets: ['Main', 'Oak', 'Maple', 'Elm', 'Cedar', 'Pine', 'Washington', 'Lake', 'Park', 'Hill',
        'River', 'Spring', 'Church', 'Mill', 'Center', 'Union', 'Broadway', 'Market', 'Walnut', 'Cherry',
        'Madison', 'Jefferson', 'Lincoln', 'Franklin', 'Highland', 'Sunset', 'Willow', 'Meadow', 'Valley', 'Forest'],
      streetTypes: ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd', 'Ct', 'Way', 'Pl', 'Cir'],
      suffixes: ['Apt', 'Unit', 'Suite', '#']
    },
    uk: {
      counties: [
        { name: 'Greater London', cities: ['London', 'Croydon', 'Bromley', 'Kingston upon Thames', 'Harrow'] },
        { name: 'Greater Manchester', cities: ['Manchester', 'Salford', 'Stockport', 'Bolton', 'Oldham'] },
        { name: 'West Midlands', cities: ['Birmingham', 'Coventry', 'Wolverhampton', 'Solihull'] },
        { name: 'West Yorkshire', cities: ['Leeds', 'Bradford', 'Wakefield', 'Huddersfield'] },
        { name: 'Merseyside', cities: ['Liverpool', 'Birkenhead', 'St Helens', 'Southport'] },
        { name: 'Tyne and Wear', cities: ['Newcastle upon Tyne', 'Sunderland', 'Gateshead'] },
        { name: 'South Yorkshire', cities: ['Sheffield', 'Doncaster', 'Rotherham'] },
        { name: 'Hampshire', cities: ['Southampton', 'Portsmouth', 'Winchester', 'Basingstoke'] },
        { name: 'Lancashire', cities: ['Preston', 'Blackpool', 'Blackburn', 'Lancaster'] },
        { name: 'Essex', cities: ['Chelmsford', 'Colchester', 'Southend-on-Sea', 'Basildon'] }
      ],
      streets: ['High', 'Station', 'Church', 'Mill', 'Green', 'Park', 'School', 'Victoria', 'Queen', 'King',
        'New', 'West', 'North', 'South', 'East', 'Bridge', 'Market', 'Manor', 'Orchard', 'Grange',
        'Meadow', 'Springfield', 'Richmond', 'Windsor', 'Stanley', 'Albert', 'George', 'Oxford', 'Cambridge', 'Clarence'],
      streetTypes: ['Road', 'Street', 'Lane', 'Avenue', 'Close', 'Drive', 'Way', 'Gardens', 'Crescent', 'Mews'],
      suffixes: ['Flat', 'Apartment', 'Floor']
    },
    jp: {
      prefectures: [
        { name: '東京都', cities: ['新宿区', '渋谷区', '港区', '千代田区', '中央区', '文京区', '台東区', '品川区', '目黒区', '豊島区'] },
        { name: '大阪府', cities: ['大阪市北区', '大阪市中央区', '大阪市天王寺区', '堺市', '吹田市', '豊中市'] },
        { name: '神奈川県', cities: ['横浜市', '川崎市', '相模原市', '鎌倉市', '藤沢市'] },
        { name: '愛知県', cities: ['名古屋市', '豊田市', '岡崎市', '一宮市', '春日井市'] },
        { name: '京都府', cities: ['京都市中京区', '京都市東山区', '京都市左京区', '宇治市', '亀岡市'] },
        { name: '北海道', cities: ['札幌市', '函館市', '旭川市', '小樽市', '帯広市'] },
        { name: '福岡県', cities: ['福岡市博多区', '福岡市中央区', '北九州市', '久留米市'] },
        { name: '兵庫県', cities: ['神戸市', '姫路市', '西宮市', '尼崎市', '明石市'] },
        { name: '千葉県', cities: ['千葉市', '船橋市', '松戸市', '柏市', '市川市'] },
        { name: '埼玉県', cities: ['さいたま市', '川口市', '川越市', '所沢市', '越谷市'] }
      ],
      streets: ['桜', '富士見', '中央', '昭和', '平和', '緑', '朝日', '本町', '元町', '栄町',
        '幸町', '末広', '曙', '高砂', '錦', '春日', '銀座', '大手町', '丸の内', '霞が関',
        '青山', '麻布', '日本橋', '四谷', '三田', '九段', '早稲田', '神楽坂', '月島', '豊洲'],
      suffixes: ['マンション', 'アパート', 'ハイツ', 'コーポ']
    },
    kr: {
      provinces: [
        { name: '서울특별시', cities: ['강남구', '서초구', '종로구', '중구', '마포구', '용산구', '송파구', '영등포구', '동대문구', '성북구'] },
        { name: '경기도', cities: ['수원시', '성남시', '고양시', '용인시', '부천시', '안산시', '화성시'] },
        { name: '부산광역시', cities: ['해운대구', '부산진구', '동래구', '남구', '수영구'] },
        { name: '인천광역시', cities: ['연수구', '남동구', '부평구', '계양구', '중구'] },
        { name: '대구광역시', cities: ['수성구', '중구', '달서구', '동구', '북구'] },
        { name: '대전광역시', cities: ['유성구', '서구', '중구', '동구', '대덕구'] },
        { name: '광주광역시', cities: ['동구', '서구', '남구', '북구', '광산구'] }
      ],
      streets: ['중앙로', '문화로', '태평로', '번영로', '삼성로', '테헤란로', '을지로', '종로',
        '강남대로', '올림픽로', '청계천로', '남대문로', '세종대로', '월드컵로', '한강대로'],
      suffixes: ['아파트', '오피스텔', '빌라'],
      dongSuffixes: ['동', '읍', '면']
    }
  };

  function initGeneratedTools(options) {
    const {
      genPwdBtn,
      pwdResult,
      genNameBtn,
      nameResult,
      genBdayBtn,
      bdayResult,
      genAddrBtn,
      addrResult,
      getFillActionLabel,
      getPasswordFillActions,
      getNameFillActions,
      getBirthdayFillActions,
      getAddressFillActions,
      updateGeneratedProfile,
      sendToActivePage,
      bindFillPreview,
      copyToClipboard,
      showMessage,
      fillProfileMessage,
      dismissGeneratedResult,
      appendGeneratedHistory,
      getGeneratedResultAutoCloseSeconds
    } = options;
    const resultTimerState = new Map();

    function recordGeneratedHistory(entry) {
      if (typeof appendGeneratedHistory !== 'function') {
        return;
      }
      Promise.resolve(appendGeneratedHistory(entry)).catch((error) => {
        console.error('保存生成历史失败', error);
      });
    }

    function clearToolResultState(container) {
      const timerState = resultTimerState.get(container);
      if (timerState) {
        window.clearInterval(timerState.intervalId);
        resultTimerState.delete(container);
      }
    }

    function startResultCountdown(container, countdownEl, dismissKind) {
      clearToolResultState(container);
      if (!countdownEl || typeof dismissGeneratedResult !== 'function' || !dismissKind) {
        return;
      }
      const totalSeconds = Math.max(1, Number.parseInt(getGeneratedResultAutoCloseSeconds?.(), 10) || 30);
      let remainingSeconds = totalSeconds;
      countdownEl.textContent = `${remainingSeconds}s`;
      countdownEl.classList.remove('hidden');
      const intervalId = window.setInterval(() => {
        remainingSeconds -= 1;
        if (remainingSeconds <= 0) {
          clearToolResultState(container);
          dismissGeneratedResult(dismissKind);
          return;
        }
        countdownEl.textContent = `${remainingSeconds}s`;
      }, 1000);
      resultTimerState.set(container, { intervalId });
    }

    function showToolResult(container, text, resultOptions = {}) {
      clearToolResultState(container);
      container.classList.remove('hidden');
      container.innerHTML = '';

      const span = document.createElement('span');
      span.className = 'tool-result-text';
      span.textContent = text;
      container.appendChild(span);

      const actions = document.createElement('div');
      actions.className = 'tool-result-actions';

      let countdownEl = null;
      if (resultOptions.dismissKind) {
        countdownEl = document.createElement('span');
        countdownEl.className = 'tool-result-timer';
        actions.appendChild(countdownEl);
      }

      const fillActions = Array.isArray(resultOptions.fillActions) && resultOptions.fillActions.length
        ? resultOptions.fillActions
        : (resultOptions.fillKind
          ? [{
              kind: resultOptions.fillKind,
              value: resultOptions.fillValue || text,
              label: resultOptions.fillLabel || getFillActionLabel(resultOptions.fillKind),
              title: resultOptions.fillTitle || getFillActionLabel(resultOptions.fillKind)
            }]
          : []);

      fillActions.forEach((action) => {
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'tool-result-action';
        fillBtn.title = action.title || action.label || getFillActionLabel(action.kind);
        fillBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg><span>${action.label || getFillActionLabel(action.kind)}</span>`;
        fillBtn.onclick = async () => {
          try {
            const fillValue = action.value || text;
            await sendToActivePage({
              type: 'fill-value',
              kind: action.kind,
              value: fillValue
            });
            copyToClipboard(fillValue, fillBtn);
          } catch (error) {
            showMessage(fillProfileMessage, `填充失败: ${error.message}`, 'error');
          }
        };
        bindFillPreview(fillBtn, { kind: action.kind });
        actions.appendChild(fillBtn);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'icon-btn';
      copyBtn.title = '复制';
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      copyBtn.onclick = () => copyToClipboard(text, copyBtn);
      actions.appendChild(copyBtn);

      if (resultOptions.dismissKind) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'icon-btn tool-result-close-btn';
        closeBtn.title = '关闭';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
        closeBtn.onclick = () => {
          clearToolResultState(container);
          dismissGeneratedResult(resultOptions.dismissKind);
        };
        actions.appendChild(closeBtn);
      }

      container.appendChild(actions);
      if (resultOptions.dismissKind) {
        startResultCountdown(container, countdownEl, resultOptions.dismissKind);
      }
    }

    function getAgeFromBirthdayParts(year, month, day) {
      const today = new Date();
      let age = today.getFullYear() - year;
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();
      if (currentMonth < month || (currentMonth === month && currentDay < day)) {
        age -= 1;
      }
      return age >= 0 ? age : 0;
    }

    genPwdBtn.addEventListener('click', () => {
      const len = Math.max(4, Math.min(128, parseInt(document.getElementById('pwd-length').value, 10) || 16));
      const useUpper = document.getElementById('pwd-upper').checked;
      const useLower = document.getElementById('pwd-lower').checked;
      const useDigit = document.getElementById('pwd-digit').checked;
      const useSpecial = document.getElementById('pwd-special').checked;
      const noAmbig = document.getElementById('pwd-no-ambig').checked;

      const ambiguous = 'O0lI1|';
      let chars = '';
      if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (useLower) chars += 'abcdefghijklmnopqrstuvwxyz';
      if (useDigit) chars += '0123456789';
      if (useSpecial) chars += '!@#$%^&*()-_=+[]{}:;<>,.?/~';

      if (!chars) {
        chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      }
      if (noAmbig) {
        chars = chars.split('').filter((char) => !ambiguous.includes(char)).join('');
      }

      let password = '';
      const randomValues = new Uint32Array(len);
      crypto.getRandomValues(randomValues);
      for (let i = 0; i < len; i += 1) {
        password += chars[randomValues[i] % chars.length];
      }

      updateGeneratedProfile({ password, confirmPassword: password });
      recordGeneratedHistory({ kind: 'password', value: password });
      showToolResult(pwdResult, password, {
        fillActions: getPasswordFillActions(password, password),
        dismissKind: 'password'
      });
    });

    genNameBtn.addEventListener('click', () => {
      const genderSelection = document.getElementById('name-gender').value;
      const region = document.getElementById('name-region').value;
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const gender = genderSelection === 'random'
        ? (Math.random() < 0.5 ? 'male' : 'female')
        : genderSelection;

      let fullName;
      let firstName;
      let lastName;
      if (region === 'en') {
        firstName = pick(NAME_DATA.en[gender]);
        lastName = pick(NAME_DATA.en.last);
        fullName = `${firstName} ${lastName}`;
      } else {
        lastName = pick(NAME_DATA.zh.surname);
        const givenPool = NAME_DATA.zh[gender];
        const givenLength = Math.random() < 0.6 ? 2 : 1;
        firstName = '';
        for (let i = 0; i < givenLength; i += 1) {
          firstName += pick(givenPool);
        }
        fullName = lastName + firstName;
      }

      updateGeneratedProfile({ fullName, firstName, lastName });
      recordGeneratedHistory({ kind: 'name', value: fullName });
      showToolResult(nameResult, fullName, {
        fillActions: getNameFillActions(fullName, firstName, lastName),
        dismissKind: 'name'
      });
    });

    genBdayBtn.addEventListener('click', () => {
      const fillMode = document.getElementById('bday-fill-mode')?.value === 'age' ? 'age' : 'date';
      let minYear = parseInt(document.getElementById('bday-min-year').value, 10) || 1980;
      let maxYear = parseInt(document.getElementById('bday-max-year').value, 10) || 2005;
      if (minYear > maxYear) {
        [minYear, maxYear] = [maxYear, minYear];
      }

      const year = minYear + Math.floor(Math.random() * (maxYear - minYear + 1));
      const month = 1 + Math.floor(Math.random() * 12);
      const daysInMonth = new Date(year, month, 0).getDate();
      const day = 1 + Math.floor(Math.random() * daysInMonth);

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const age = getAgeFromBirthdayParts(year, month, day);
      const ageStr = String(age);

      updateGeneratedProfile(fillMode === 'age'
        ? { birthday: '', age: ageStr }
        : { birthday: dateStr, age: '' });
      recordGeneratedHistory(fillMode === 'age'
        ? { kind: 'age', value: ageStr }
        : { kind: 'birthday', value: dateStr });
      showToolResult(bdayResult, fillMode === 'age' ? `${ageStr} 岁` : `${dateStr}（${age} 岁）`, {
        fillActions: getBirthdayFillActions(
          fillMode === 'age' ? '' : dateStr,
          fillMode === 'age' ? ageStr : ''
        ),
        dismissKind: 'birthday'
      });
    });

    genAddrBtn.addEventListener('click', () => {
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
      const region = document.getElementById('addr-region')?.value || 'zh';

      let address;
      if (region === 'zh') {
        const data = ADDRESS_DATA.zh;
        const province = pick(data.provinces);
        const city = pick(province.cities);
        const road = pick(data.roads);
        const roadNum = randInt(1, 300);
        const suffix = pick(data.suffixes);
        const buildingPrefix = pick(data.buildingPrefixes);
        const buildingNum = randInt(1, 30);
        const unitNum = randInt(1, 5);
        const roomNum = randInt(101, 2808);
        address = `${province.name}${city}${road}${roadNum}号${suffix}${buildingPrefix}栋${buildingNum}单元${String(unitNum).padStart(2, '0')}${roomNum}室`;
      } else if (region === 'en') {
        const data = ADDRESS_DATA.en;
        const state = pick(data.states);
        const city = pick(state.cities);
        const num = randInt(100, 9999);
        const street = pick(data.streets);
        const streetType = pick(data.streetTypes);
        const suffix = pick(data.suffixes);
        const aptNum = randInt(1, 500);
        const zip5 = String(randInt(10000, 99999));
        const zip4 = String(randInt(1000, 9999));
        address = `${num} ${street} ${streetType}, ${suffix} ${aptNum}, ${city}, ${state.name} ${zip5}-${zip4}`;
      } else if (region === 'uk') {
        const data = ADDRESS_DATA.uk;
        const county = pick(data.counties);
        const city = pick(county.cities);
        const num = randInt(1, 200);
        const street = pick(data.streets);
        const streetType = pick(data.streetTypes);
        const suffix = pick(data.suffixes);
        const suffixNum = randInt(1, 100);
        const postcodeArea = pick(['SW', 'NW', 'SE', 'NE', 'EC', 'WC', 'E', 'W', 'N', 'S', 'B', 'M', 'L', 'G']);
        const postcodeNum = randInt(1, 20);
        const postcodeSuffix = pick(['AA', 'AB', 'AD', 'AE', 'AG', 'AH', 'AL', 'AN', 'AR', 'AT', 'BA', 'BB', 'BD', 'BE', 'BG', 'BH', 'BL', 'BN', 'BP', 'BQ', 'BR', 'BS', 'BT', 'BU', 'BW', 'BX', 'BY', 'BZ']);
        address = `${num} ${street} ${streetType}, ${suffix} ${suffixNum}, ${city}, ${county.name}, ${postcodeArea}${postcodeNum} ${randInt(1, 9)}${postcodeSuffix}`;
      } else if (region === 'jp') {
        const data = ADDRESS_DATA.jp;
        const prefecture = pick(data.prefectures);
        const city = pick(prefecture.cities);
        const street = pick(data.streets);
        const chome = randInt(1, 7);
        const ban = randInt(1, 30);
        const go = randInt(1, 20);
        const suffix = pick(data.suffixes);
        const roomNum = randInt(101, 888);
        const postal3 = String(randInt(100, 999));
        const postal4 = String(randInt(1000, 9999));
        address = `〒${postal3}-${postal4} ${prefecture.name}${city}${street}${chome}丁目${ban}番${go}号 ${suffix}${roomNum}号室`;
      } else if (region === 'kr') {
        const data = ADDRESS_DATA.kr;
        const province = pick(data.provinces);
        const city = pick(province.cities);
        const street = pick(data.streets);
        const streetNum = randInt(1, 200);
        const suffix = pick(data.suffixes);
        const dongSuffix = pick(data.dongSuffixes);
        const dongNum = randInt(1, 50);
        const dongName = pick(['신천', '삼성', '역삼', '서초', '잠실', '청담', '반포', '도곡', '대치', '개포', '수서', '일원', '방배', '논현', '압구정',
          '홍대', '연희', '합정', '망원', '상수', '이촌', '한남', '옥수', '왕십리', '성수', '자양', '구의', '신사', '가락', '방이']);
        const hoNum = randInt(101, 2003);
        const postal5 = String(randInt(10000, 99999));
        address = `(${postal5}) ${province.name} ${city} ${dongName}${dongSuffix} ${street} ${streetNum}길 ${randInt(1, 50)}, ${suffix} ${dongNum}${dongSuffix} ${hoNum}호`;
      } else {
        address = '';
      }

      if (!address) return;

      updateGeneratedProfile({ address });
      recordGeneratedHistory({ kind: 'address', value: address });
      showToolResult(addrResult, address, {
        fillActions: getAddressFillActions(address),
        dismissKind: 'address'
      });
    });

    return {
      showToolResult,
      clearToolResultState
    };
  }

  window.PopupToolGenerators = {
    initGeneratedTools
  };
})();
