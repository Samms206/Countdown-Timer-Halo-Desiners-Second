$(document).ready(function () {
  // Set minimum date untuk date picker
  const today = new Date();
  const formattedDate = today.toISOString().split("T")[0];
  $("#startDate").attr("min", formattedDate);

  // Set API URL
  const baseUrl = window.location.origin;
  $("#apiUrl").val(`${baseUrl}/api/timer`);

  // Mendapatkan timezone offset dalam menit
  const timezoneOffset = new Date().getTimezoneOffset();
  console.log(`Browser timezone offset: ${timezoneOffset} minutes`);

  // Tab switching functionality
  $(".tab-button").on("click", function () {
    // Remove active class from all buttons and panes
    $(".tab-button").removeClass("active");
    $(".tab-pane").removeClass("active");

    // Add active class to clicked button and corresponding pane
    $(this).addClass("active");
    const tabId = $(this).data("tab");
    $(`#${tabId}`).addClass("active");

    // Load schedules when switching to schedule tab
    if (tabId === "schedule-tab") {
      loadSchedules();
    }
  });

  // Fungsi untuk mengambil status timer
  function getTimerStatus() {
    $.ajax({
      url: "/api/timer",
      type: "GET",
      dataType: "json",
      success: function (data) {
        // Update UI
        $("#hours").text(data.hours);
        $("#minutes").text(data.minutes);
        $("#seconds").text(data.seconds);
      },
      error: function (xhr, status, error) {
        console.error("Error fetching timer status:", error);
        Swal.fire({
          icon: "error",
          title: "Error",
          text: `Gagal mengambil status timer: ${error}`,
        });
      },
    });
  }

  // Set timer baru secara manual
  $("#setTimerBtn").on("click", function () {
    const hours = $("#hoursInput").val().trim();

    if (!hours) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Silakan masukkan jumlah jam",
      });
      return;
    }

    // Tampilkan popup password
    Swal.fire({
      title: "Masukkan Password",
      input: "password",
      inputPlaceholder: "Password",
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value) {
          return "Password harus diisi";
        }
      },
    }).then((result) => {
      if (result.isConfirmed) {
        const password = result.value;

        // Tampilkan loading
        Swal.fire({
          title: "Memproses...",
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          },
        });

        $.ajax({
          url: "/api/timer",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({ hours, password }),
          success: function (data) {
            Swal.fire({
              icon: "success",
              title: "Berhasil",
              text: `Timer telah diatur untuk ${hours} jam`,
            });

            // Update timer status
            getTimerStatus();
          },
          error: function (xhr, status, error) {
            let errorMsg = "Terjadi kesalahan";
            try {
              const response = JSON.parse(xhr.responseText);
              errorMsg = response.error || errorMsg;
            } catch (e) {}

            Swal.fire({
              icon: "error",
              title: "Error",
              text: errorMsg,
            });
          },
        });
      }
    });
  });

  // Fungsi untuk menambahkan timer terjadwal
  $("#scheduleTimerBtn").on("click", function () {
    const startDate = $("#startDate").val();
    const startTime = $("#startTime").val();
    const duration = $("#duration").val();

    // Validasi input
    if (!startDate || !startTime || !duration) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Semua field harus diisi",
      });
      return;
    }

    // Validasi tanggal dan waktu tidak di masa lalu
    const selectedDateTime = new Date(`${startDate}T${startTime}`);
    const now = new Date();

    if (selectedDateTime <= now) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Tanggal dan waktu harus di masa depan",
      });
      return;
    }

    // Tampilkan popup password
    Swal.fire({
      title: "Masukkan Password",
      input: "password",
      inputPlaceholder: "Password",
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value) {
          return "Password harus diisi";
        }
      },
    }).then((result) => {
      if (result.isConfirmed) {
        const password = result.value;

        // Tampilkan loading
        Swal.fire({
          title: "Memproses...",
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          },
        });

        const localDateTime = new Date(`${startDate}T${startTime}`);
        const unixTimestamp = localDateTime.getTime();

        $.ajax({
          url: "/api/schedule",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({
            timestamp: unixTimestamp,
            startDate,
            startTime,
            duration,
            password,
            timezone: timezoneOffset,
            isUTC: false, 
          }),
          success: function (data) {
            Swal.fire({
              icon: "success",
              title: "Berhasil",
              text: `Timer telah dijadwalkan untuk ${duration} jam pada ${formatDateTime(
                startDate,
                startTime
              )}`,
            });

            // Reset form
            $("#startDate").val("");
            $("#startTime").val("");
            $("#duration").val("");

            // Refresh daftar jadwal
            loadSchedules();
          },
          error: function (xhr, status, error) {
            let errorMsg = "Terjadi kesalahan";
            try {
              const response = JSON.parse(xhr.responseText);
              errorMsg = response.error || errorMsg;
            } catch (e) {}

            Swal.fire({
              icon: "error",
              title: "Error",
              text: errorMsg,
            });
          },
        });
      }
    });
  });

  // Fungsi untuk memuat daftar jadwal
  function loadSchedules() {
    $("#schedulesList").html('<div class="loading">Memuat jadwal...</div>');

    $.ajax({
      url: "/api/schedules",
      type: "GET",
      success: function (data) {
        console.log("Raw schedules data:", data);

        if (data.schedules && data.schedules.length > 0) {
          $("#schedulesList").empty();

          $.each(data.schedules, function (i, schedule) {
            console.log("Processing schedule:", schedule);
            console.log("Schedule status:", schedule.status);

            // PERUBAHAN DI SINI: Lebih aman menggunakan timezone yang disimpan
            // ketika schedule dibuat untuk menghindari konversi ganda
            let startDate;

            if (typeof schedule.startAt === "number") {
              // Jika format timestamp (angka), gunakan secara langsung
              startDate = new Date(schedule.startAt);
            } else {
              // Jika format string, parse dulu
              startDate = new Date(schedule.startAt);
            }

            console.log("Original startAt from server:", schedule.startAt);
            console.log("Parsed startDate:", startDate.toString());

            const formattedDate = startDate.toLocaleDateString("id-ID", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            const formattedTime = startDate.toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            });

            let statusClass = "pending";
            let statusText = "Menunggu waktu mulai";

            // Penanganan status baru
            if (schedule.status === "activated") {
              statusClass = "activated";
              statusText = "Sedang berjalan";
            } else if (schedule.status === "pending") {
              statusClass = "pending";
              statusText = "Menunggu waktu mulai";
            } else if (schedule.status === "expired") {
              statusClass = "expired";
              statusText = "Waktu sudah terlewat";
            } else if (schedule.status === "completed") {
              statusClass = "completed";
              statusText = "Selesai";
            }
            // Penanganan format lama
            else if (schedule.active === true) {
              statusClass = "activated";
              statusText = "Sedang berjalan";
            } else if (schedule.active === false) {
              const now = Date.now();
              if (schedule.startAt <= now) {
                statusClass = "expired";
                statusText = "Waktu sudah terlewat";
              } else {
                statusClass = "pending";
                statusText = "Menunggu waktu mulai";
              }
            }

            console.log("Browser timezone offset:", -timezoneOffset);
            console.log("Schedule timezone offset:", schedule.timezoneOffset);
            console.log(
              "UTC Start time:",
              new Date(schedule.startAt).toISOString()
            );
            console.log("Local Start time:", startDate.toLocaleString());

            console.log("Assigned statusClass:", statusClass);
            console.log("Assigned statusText:", statusText);

            const scheduleItem = $(`
              <div class="schedule-item schedule-${statusClass}">
                <div class="schedule-info">
                  <div class="schedule-date">${formattedDate}, ${formattedTime}</div>
                  <div class="schedule-duration">Durasi: ${schedule.duration} jam</div>
                  <div class="schedule-status ${statusClass}">${statusText}</div>
                </div>
                <button class="delete-schedule" data-id="${schedule.id}">Hapus</button>
              </div>
            `);

            $("#schedulesList").append(scheduleItem);

            // Tambahkan event listener untuk tombol hapus
            scheduleItem.find(".delete-schedule").on("click", function () {
              deleteSchedule($(this).data("id"));
            });
          });
        } else {
          $("#schedulesList").html(
            '<div class="no-schedules">Tidak ada jadwal timer</div>'
          );
        }
      },
      error: function (xhr, status, error) {
        console.error("Error loading schedules:", error);
        $("#schedulesList").html(
          `<div class="no-schedules">Error: ${error}</div>`
        );
      },
    });
  }

  // Fungsi untuk menghapus jadwal
  function deleteSchedule(id) {
    // Tampilkan popup password
    Swal.fire({
      title: "Masukkan Password",
      input: "password",
      inputPlaceholder: "Password",
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value) {
          return "Password harus diisi";
        }
      },
    }).then((result) => {
      if (result.isConfirmed) {
        const password = result.value;

        // Tampilkan loading
        Swal.fire({
          title: "Memproses...",
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          },
        });

        
        $.ajax({
          url: `/api/schedule/${id}?password=${encodeURIComponent(password)}`,
          type: "DELETE",
          success: function (data) {
            Swal.fire({
              icon: "success",
              title: "Berhasil",
              text: "Jadwal timer telah dihapus",
            });

            // Refresh daftar jadwal
            loadSchedules();
          },
          error: function (xhr, status, error) {
            let errorMsg = "Terjadi kesalahan";
            try {
              const response = JSON.parse(xhr.responseText);
              errorMsg = response.error || errorMsg;
            } catch (e) {}

            Swal.fire({
              icon: "error",
              title: "Error",
              text: errorMsg,
            });
          },
        });
      }
    });
  }

  // Helper function untuk format tanggal dan waktu
  function formatDateTime(dateStr, timeStr) {
    const [year, month, day] = dateStr.split("-");
    const [hours, minutes] = timeStr.split(":");

    const date = new Date(year, month - 1, day, hours, minutes);

    return date.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Tombol salin API URL
  $("#copyBtn").on("click", function () {
    $("#apiUrl").select();
    document.execCommand("copy");

    Swal.fire({
      icon: "success",
      title: "URL API telah disalin",
      showConfirmButton: false,
      timer: 1500,
    });
  });

  // Update timer setiap detik dan jadwal setiap 10 detik
  function startTimerUpdate() {
    getTimerStatus();
    setInterval(getTimerStatus, 1000);

    // Jika kita berada di tab schedule, refresh jadwal setiap 10 detik
    setInterval(function () {
      if ($("#schedule-tab").hasClass("active")) {
        loadSchedules();
      }
    }, 10000);
  }

  // Mulai update timer
  startTimerUpdate();
});
