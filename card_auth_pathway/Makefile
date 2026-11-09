# Makefile - HPE Tandem PATHWAY 카드 승인 서버

# Tandem Native 컴파일러 (실제 환경에 맞게 수정)
CC      = cc
CFLAGS  = -W all -D TANDEM_NATIVE

# Windows/GCC 테스트용 (주석 해제하여 사용)
# CC      = gcc
# CFLAGS  = -Wall -Wextra -std=c99 -D _WIN32

TARGET  = card_auth_server
SRCS    = card_auth.c pathway_main.c pathway_req.c pathway_resp.c host_link.c
OBJS    = $(SRCS:.c=.o)

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) -lpathway

%.o: %.c card_auth.h
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f *.o $(TARGET)